from __future__ import annotations

import base64
import os
import tempfile
import time
from io import BytesIO
from typing import Any

import cv2
import numpy as np
import requests
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field

from crop import (
    FOOD_CLASS_NAMES,
    PLATE_CLASS_NAMES,
    PLATE_SCENE_NAMES,
    POSE_NAMES,
    TABLE_CLASS_NAMES,
    choose_anchor,
    crop_9_16,
    crop_score,
    ema,
    face_bbox_from_pose,
    is_full_body,
    pose_center,
    suggested_shot,
)

DETECT_MODEL = os.getenv("YOLO_MODEL", "yolov8n.pt")
POSE_MODEL = os.getenv("YOLO_POSE_MODEL", "yolov8n-pose.pt")
FACE_MODEL = os.getenv("YOLO_FACE_MODEL", "yolov8n-face.pt")
SEG_MODEL = os.getenv("YOLO_SEG_MODEL", "yolov8n-seg.pt")
DEFAULT_CONF = float(os.getenv("YOLO_CONF", "0.35"))
MAX_SECONDS = float(os.getenv("YOLO_MAX_SECONDS", "20"))
FPS_SAMPLE = float(os.getenv("YOLO_FPS_SAMPLE", "2"))
API_KEY = os.getenv("YOLO_API_KEY", "").strip()

_models: dict[str, Any] = {"detect": None, "pose": None, "face": None, "seg": None}
_face_failed = False
_seg_failed = False

app = FastAPI(title="CenaPronta YOLO", version="1.0.0")


class FrameRequest(BaseModel):
    image_url: str | None = None
    image_base64: str | None = None
    aspect_ratio: str = "9:16"
    mode: str = Field(default="auto", pattern="^(auto|person|face|plate)$")
    confidence: float | None = None
    include_pose: bool = True
    include_face: bool = True


class VideoRequest(BaseModel):
    video_url: str | None = None
    fps_sample: float | None = None
    aspect_ratio: str = "9:16"
    mode: str = Field(default="auto", pattern="^(auto|person|face|plate)$")
    max_seconds: float | None = None
    confidence: float | None = None


def require_key(authorization: str | None) -> None:
    if not API_KEY:
        return
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token != API_KEY:
        raise HTTPException(status_code=401, detail="unauthorized")


def load_yolo(path: str):
    from ultralytics import YOLO

    model = YOLO(path)
    model.fuse()
    dummy = np.zeros((640, 640, 3), dtype=np.uint8)
    _ = model(dummy, verbose=False)
    return model


def get_model(kind: str):
    global _face_failed, _seg_failed
    if kind == "face" and _face_failed:
        return None
    if kind == "seg" and _seg_failed:
        return None
    if _models[kind] is None:
        names = {"detect": DETECT_MODEL, "pose": POSE_MODEL, "face": FACE_MODEL, "seg": SEG_MODEL}
        try:
            _models[kind] = load_yolo(names[kind])
        except Exception:
            if kind == "face":
                _face_failed = True
                return None
            if kind == "seg":
                _seg_failed = True
                return None
            raise
    return _models[kind]


def decode_image(req: FrameRequest) -> np.ndarray:
    if req.image_base64:
        payload = req.image_base64.split(",", 1)[-1]
        raw = base64.b64decode(payload)
        image = Image.open(BytesIO(raw)).convert("RGB")
        return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    if req.image_url:
        response = requests.get(req.image_url, timeout=20)
        response.raise_for_status()
        image = Image.open(BytesIO(response.content)).convert("RGB")
        return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    raise HTTPException(status_code=400, detail="image_url or image_base64 required")


def boxes_xywh(result) -> list[dict]:
    items = []
    if result.boxes is None:
        return items
    names = result.names
    ids = result.boxes.id
    for index, box in enumerate(result.boxes):
        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().tolist()
        cls = int(box.cls[0])
        track_id = None
        if ids is not None:
            track_id = int(ids[index].cpu().numpy())
        items.append({
            "class_id": cls,
            "class_name": names.get(cls, str(cls)),
            "confidence": float(box.conf[0]),
            "bbox": [int(x1), int(y1), int(max(1, x2 - x1)), int(max(1, y2 - y1))],
            "track_id": track_id,
        })
    return items


def pose_people(image: np.ndarray, conf: float, detect_people: list[dict]) -> list[dict]:
    model = get_model("pose")
    people = [dict(item) for item in detect_people]
    for person in people:
        person.setdefault("is_full_body", False)
        person.setdefault("pose", None)
    if model is None:
        return people
    results = model(image, conf=conf, verbose=False)
    frame_h, frame_w = image.shape[:2]
    result = results[0]
    boxes = boxes_xywh(result)
    kpts = result.keypoints
    posed: list[dict] = []
    for index, box in enumerate(boxes):
        kps = []
        if kpts is not None and kpts.xy is not None and index < len(kpts.xy):
            xy = kpts.xy[index].cpu().numpy()
            confs = kpts.conf[index].cpu().numpy() if kpts.conf is not None else np.ones(len(xy))
            for kp_index, name in enumerate(POSE_NAMES):
                if kp_index >= len(xy):
                    break
                x, y = xy[kp_index]
                kps.append({
                    "name": name,
                    "x": float(x / frame_w) if frame_w else 0.0,
                    "y": float(y / frame_h) if frame_h else 0.0,
                    "confidence": float(confs[kp_index]),
                })
        cx, cy = pose_center(kps, frame_w, frame_h) if kps else (None, None)
        posed.append({
            "class_id": 0,
            "class_name": "person",
            "confidence": box["confidence"],
            "bbox": box["bbox"],
            "track_id": box.get("track_id"),
            "pose": {"keypoints": kps, "center_x": cx, "center_y": cy} if kps else None,
            "is_full_body": is_full_body(kps) if kps else False,
        })
    return posed or people


def detect_faces(image: np.ndarray, conf: float, people: list[dict]) -> list[dict]:
    frame_h, frame_w = image.shape[:2]
    model = get_model("face")
    faces: list[dict] = []
    if model is not None:
        results = model(image, conf=max(conf, 0.4), verbose=False)
        for item in boxes_xywh(results[0]):
            faces.append({"confidence": item["confidence"], "bbox": item["bbox"], "from": "face_model"})
    if faces:
        return faces
    for person in people:
        pose = person.get("pose") or {}
        kps = pose.get("keypoints") or []
        bbox = face_bbox_from_pose(kps, frame_w, frame_h)
        if bbox:
            faces.append({"confidence": 0.5, "bbox": bbox, "from": "pose_fallback"})
    return faces


def split_scene(items: list[dict]) -> tuple[list[dict], list[dict], bool]:
    plates, food = [], []
    scene = False
    for item in items:
        name = item["class_name"]
        if name not in PLATE_SCENE_NAMES:
            continue
        scene = True
        row = {"class_name": name, "confidence": item["confidence"], "bbox": item["bbox"]}
        if name in PLATE_CLASS_NAMES or name in TABLE_CLASS_NAMES:
            plates.append(row)
        elif name in FOOD_CLASS_NAMES:
            food.append(row)
        else:
            plates.append(row)
    return plates, food, scene


def analyze_ndarray(image: np.ndarray, mode: str, conf: float, include_pose: bool, include_face: bool) -> dict:
    started = time.perf_counter()
    detect = get_model("detect")
    results = detect(image, conf=conf, verbose=False)
    items = boxes_xywh(results[0])
    people = [item for item in items if item["class_name"] == "person"]
    for person in people:
        person["is_full_body"] = False
        person["pose"] = None
    if include_pose and people:
        people = pose_people(image, conf, people)
    faces = detect_faces(image, conf, people) if include_face and (people or mode == "face") else []
    plates, food, has_plate_scene = split_scene(items)
    frame_h, frame_w = image.shape[:2]
    cx, cy, anchor = choose_anchor(mode, people, faces, plates, food, frame_w, frame_h)
    bbox = crop_9_16(frame_w, frame_h, cx, cy)
    has_person = bool(people)
    has_face = bool(faces)
    shot = suggested_shot(people, faces, has_plate_scene, mode)
    return {
        "success": True,
        "frame": {"width": frame_w, "height": frame_h},
        "people": [
            {
                "track_id": p.get("track_id"),
                "confidence": p["confidence"],
                "bbox": p["bbox"],
                "is_full_body": p.get("is_full_body", False),
                "pose": p.get("pose"),
            }
            for p in people
        ],
        "faces": faces,
        "plates": plates,
        "food": food,
        "has_person": has_person,
        "has_face": has_face,
        "has_plate_scene": has_plate_scene,
        "suggested_shot": shot,
        "crop": {
            "aspect": "9:16",
            "bbox": bbox,
            "anchor": anchor,
            "score": crop_score(anchor, has_person, has_face, has_plate_scene, mode),
        },
        "inference_time_ms": int((time.perf_counter() - started) * 1000),
    }


def download_video(url: str) -> str:
    response = requests.get(url, timeout=60, stream=True)
    response.raise_for_status()
    handle = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    for chunk in response.iter_content(1_048_576):
        handle.write(chunk)
    handle.close()
    return handle.name


def sample_video(path: str, fps_sample: float, max_seconds: float):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="unable to open video")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = total / src_fps if src_fps else 0
    duration = min(duration, max_seconds) if duration else max_seconds
    step = max(1, int(round(src_fps / max(0.5, fps_sample))))
    frames = []
    index = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = index / src_fps
        if t > max_seconds:
            break
        if index % step == 0:
            frames.append((t, frame))
        index += 1
    cap.release()
    return duration, src_fps, frames


def score_window(rows: list[dict], mode: str) -> tuple[float, str, bool, bool]:
    if not rows:
        return 0.0, "vazio", False, False
    person_ratio = sum(1 for r in rows if r["has_person"]) / len(rows)
    face_ratio = sum(1 for r in rows if r["has_face"]) / len(rows)
    plate_ratio = sum(1 for r in rows if r["has_plate_scene"]) / len(rows)
    xs = [r["crop"]["bbox"][0] for r in rows]
    jitter = (max(xs) - min(xs)) / max(1, rows[0]["frame"]["width"]) if xs else 1
    score = 0.0
    score += 0.35 if person_ratio >= 0.6 else person_ratio * 0.2
    score += 0.25 * face_ratio
    score += 0.15 if person_ratio >= 0.8 else 0.0
    if mode == "plate":
        score += 0.15 * plate_ratio
    score += 0.10 if jitter < 0.08 else 0.0
    if person_ratio < 0.2 and plate_ratio < 0.2 and mode != "plate":
        score = 0.0
    reasons = []
    if person_ratio >= 0.6:
        reasons.append("pessoa estável")
    if face_ratio >= 0.5:
        reasons.append("rosto visível")
    if plate_ratio >= 0.4:
        reasons.append("cena de prato")
    return round(min(1.0, score), 2), " + ".join(reasons) or "baixo sinal", face_ratio >= 0.5, plate_ratio >= 0.3


@app.middleware("http")
async def auth_middleware(request, call_next):
    if request.url.path != "/health":
        try:
            require_key(request.headers.get("authorization"))
        except HTTPException as error:
            return JSONResponse({"detail": error.detail}, status_code=error.status_code)
    return await call_next(request)


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "models_loaded": {kind: _models[kind] is not None for kind in _models},
        "lazy_loading": True,
        "face_available": not _face_failed,
        "max_seconds": MAX_SECONDS,
        "device": "cpu",
    }


@app.post("/analyze-frame")
def analyze_frame(body: FrameRequest):
    image = decode_image(body)
    conf = body.confidence if body.confidence is not None else DEFAULT_CONF
    return analyze_ndarray(image, body.mode, conf, body.include_pose, body.include_face)


@app.post("/analyze-video")
def analyze_video(body: VideoRequest):
    if not body.video_url:
        raise HTTPException(status_code=400, detail="video_url required")
    path = download_video(body.video_url)
    try:
        return analyze_video_path(
            path,
            mode=body.mode,
            fps_sample=body.fps_sample or FPS_SAMPLE,
            max_seconds=min(MAX_SECONDS, body.max_seconds or MAX_SECONDS),
            conf=body.confidence if body.confidence is not None else DEFAULT_CONF,
        )
    finally:
        os.unlink(path)


@app.post("/analyze-video-upload")
async def analyze_video_upload(
    video: UploadFile = File(...),
    mode: str = "auto",
    fps_sample: float = FPS_SAMPLE,
    max_seconds: float = MAX_SECONDS,
    authorization: str | None = Header(default=None),
):
    require_key(authorization)
    suffix = os.path.splitext(video.filename or "clip.mp4")[1] or ".mp4"
    handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    handle.write(await video.read())
    handle.close()
    try:
        return analyze_video_path(handle.name, mode, fps_sample, min(MAX_SECONDS, max_seconds), DEFAULT_CONF)
    finally:
        os.unlink(handle.name)


def analyze_video_path(path: str, mode: str, fps_sample: float, max_seconds: float, conf: float):
    duration, fps, frames = sample_video(path, fps_sample, max_seconds)
    rows = []
    cx_prev = cy_prev = None
    subject_track = None
    for t, frame in frames:
        row = analyze_ndarray(frame, mode, conf, include_pose=True, include_face=True)
        people = row["people"]
        if people:
            top = max(people, key=lambda p: p["bbox"][2] * p["bbox"][3])
            subject_track = top.get("track_id") or subject_track
        x, y, w, h = row["crop"]["bbox"]
        cx = ema(cx_prev, x + w / 2)
        cy = ema(cy_prev, y + h / 2)
        cx_prev, cy_prev = cx, cy
        row["crop"]["bbox"] = crop_9_16(row["frame"]["width"], row["frame"]["height"], cx, cy)
        row["t"] = t
        rows.append(row)

    if not rows:
        raise HTTPException(status_code=400, detail="no frames sampled")

    score, reason, has_face, has_plate = score_window(rows, mode)
    mid = rows[len(rows) // 2]["crop"]["bbox"]
    keyframes = [
        {"t": round(rows[0]["t"], 2), "bbox": rows[0]["crop"]["bbox"]},
        {"t": round(rows[len(rows) // 2]["t"], 2), "bbox": mid},
        {"t": round(rows[-1]["t"], 2), "bbox": rows[-1]["crop"]["bbox"]},
    ]
    return {
        "success": True,
        "duration_s": round(duration, 2),
        "fps": round(fps, 2),
        "subject_track_id": subject_track,
        "sampled_frames": len(rows),
        "segments": [
            {
                "start_s": 0.0,
                "end_s": round(min(duration, max_seconds), 2),
                "score": score,
                "reason": reason,
                "has_face": has_face,
                "has_plate_scene": has_plate,
                "crop": {"aspect": "9:16", "bbox": mid, "anchor": rows[len(rows) // 2]["crop"]["anchor"]},
                "crop_keyframes": keyframes,
            }
        ],
    }


@app.post("/detect")
def detect(body: FrameRequest):
    image = decode_image(body)
    conf = body.confidence if body.confidence is not None else DEFAULT_CONF
    results = get_model("detect")(image, conf=conf, verbose=False)
    return {"success": True, "detections": boxes_xywh(results[0])}


@app.post("/pose/analyze")
def pose_analyze(body: FrameRequest):
    image = decode_image(body)
    conf = body.confidence if body.confidence is not None else DEFAULT_CONF
    detect_items = boxes_xywh(get_model("detect")(image, conf=conf, verbose=False)[0])
    people = [item for item in detect_items if item["class_name"] == "person"]
    return {"success": True, "people": pose_people(image, conf, people)}
