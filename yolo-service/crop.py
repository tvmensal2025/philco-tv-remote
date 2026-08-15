"""Crop 9:16 a partir de pessoa / pose / face / prato. Sem dependência de Ultralytics."""

from __future__ import annotations

POSE_NAMES = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]

PLATE_CLASS_NAMES = {"bowl"}
FOOD_CLASS_NAMES = {
    "banana",
    "apple",
    "sandwich",
    "orange",
    "broccoli",
    "carrot",
    "hot dog",
    "pizza",
    "donut",
    "cake",
}
TABLE_CLASS_NAMES = {"dining table"}
TABLEWARE_CLASS_NAMES = {"cup", "bottle", "wine glass", "fork", "knife", "spoon"}
PLATE_SCENE_NAMES = PLATE_CLASS_NAMES | FOOD_CLASS_NAMES | TABLE_CLASS_NAMES | TABLEWARE_CLASS_NAMES

FACE_KEYPOINTS = ("nose", "left_eye", "right_eye", "left_ear", "right_ear")


def crop_9_16(frame_w: int, frame_h: int, cx: float, cy: float) -> list[int]:
    """cx, cy em pixels. Janela 9:16 máxima que cabe no frame."""
    target_ratio = 9 / 16
    frame_ratio = frame_w / frame_h if frame_h else target_ratio

    if frame_ratio > target_ratio:
        crop_h = frame_h
        crop_w = int(crop_h * target_ratio)
    else:
        crop_w = frame_w
        crop_h = int(crop_w / target_ratio)
        if crop_h > frame_h:
            crop_h = frame_h
            crop_w = int(crop_h * target_ratio)

    crop_w = _even(max(2, min(crop_w, frame_w)), frame_w)
    crop_h = _even(max(2, min(crop_h, frame_h)), frame_h)
    x = max(0, min(_even_floor(cx - crop_w / 2), frame_w - crop_w))
    y = max(0, min(_even_floor(cy - crop_h / 2), frame_h - crop_h))
    return [x, y, crop_w, crop_h]


def _even_floor(value: float) -> int:
    v = max(0, int(value))
    return v if v % 2 == 0 else max(0, v - 1)


def _even(value: float, cap: int | None = None) -> int:
    value = max(2, int(value))
    if value % 2:
        value += 1
    if cap is not None:
        limit = cap if cap % 2 == 0 else cap - 1
        if value > limit:
            value = max(2, limit)
    return value


def crop_contain_9_16(
    frame_w: int,
    frame_h: int,
    subject: list[int],
    pad: float = 0.12,
) -> tuple[list[int], str, bool]:
    """Janela 9:16 que contém o bbox. Se o corpo não cabe, pad_blur."""
    if frame_w < 32 or frame_h < 32 or len(subject) != 4:
        box = crop_9_16(frame_w, frame_h, frame_w / 2, frame_h / 2)
        return box, "crop", True
    sx, sy, sw, sh = [int(v) for v in subject]
    pad_x = max(8, int(sw * pad))
    pad_y = max(8, int(sh * pad))
    x1 = max(0, sx - pad_x)
    y1 = max(0, sy - pad_y)
    x2 = min(frame_w, sx + sw + pad_x)
    y2 = min(frame_h, sy + sh + pad_y)
    pw, ph = x2 - x1, y2 - y1
    window_w = _even(min(frame_w, frame_h * 9 / 16), frame_w)
    if pw <= window_w:
        x = int(x1 + pw / 2 - window_w / 2)
        if x1 < x:
            x = int(x1)
        if x1 + pw > x + window_w:
            x = int(x1 + pw - window_w)
        x = max(0, min(_even_floor(x), frame_w - window_w))
        tight = pw > window_w * 0.78
        return [x, 0, window_w, _even(frame_h, frame_h)], "crop", tight
    x = _even_floor(x1)
    y = _even_floor(y1)
    w = _even(pw, frame_w - x)
    h = _even(ph, frame_h - y)
    return [x, y, w, h], "pad_blur", True


def pick_standing_person(people: list[dict]) -> dict | None:
    if not people:
        return None

    def score(person: dict) -> float:
        _x, _y, w, h = person["bbox"]
        standing = 1.25 if h > w * 1.15 else 1.0
        full = 1.15 if person.get("is_full_body") else 1.0
        return bbox_area(person["bbox"]) * standing * full

    return max(people, key=score)


def pose_center(keypoints: list[dict], frame_w: int, frame_h: int) -> tuple[float | None, float | None]:
    by = {k["name"]: k for k in keypoints if k.get("confidence", 0) > 0.4}

    def xy(name: str):
        k = by.get(name)
        if not k:
            return None
        return (k["x"] * frame_w, k["y"] * frame_h)

    nose = xy("nose")
    ls, rs = xy("left_shoulder"), xy("right_shoulder")
    lh, rh = xy("left_hip"), xy("right_hip")

    xs, ys = [], []
    if ls and rs:
        xs.append((ls[0] + rs[0]) / 2)
        ys.append((ls[1] + rs[1]) / 2)
    if nose:
        xs.append(nose[0])
        ys.append(nose[1])
    if lh and rh:
        xs.append((lh[0] + rh[0]) / 2)
        ys.append((lh[1] + rh[1]) / 2)
    if not xs:
        return None, None
    return sum(xs) / len(xs) / frame_w, sum(ys) / len(ys) / frame_h


def is_full_body(keypoints: list[dict], min_conf: float = 0.5) -> bool:
    return sum(1 for k in keypoints if k.get("confidence", 0) > min_conf) >= 12


def face_bbox_from_pose(keypoints: list[dict], frame_w: int, frame_h: int, pad: float = 0.4) -> list[int] | None:
    pts = []
    for name in FACE_KEYPOINTS:
        match = next((k for k in keypoints if k["name"] == name and k.get("confidence", 0) > 0.4), None)
        if match:
            pts.append((match["x"] * frame_w, match["y"] * frame_h))
    if len(pts) < 2:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    w = max(8.0, x2 - x1)
    h = max(8.0, y2 - y1)
    x1 -= w * pad
    y1 -= h * pad
    x2 += w * pad
    y2 += h * pad
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(frame_w, x2)
    y2 = min(frame_h, y2)
    return [int(x1), int(y1), int(x2 - x1), int(y2 - y1)]


def bbox_center(bbox: list[int], y_weight: float = 0.5) -> tuple[float, float]:
    x, y, w, h = bbox
    return x + w / 2, y + h * y_weight


def bbox_area(bbox: list[int]) -> int:
    return max(0, bbox[2]) * max(0, bbox[3])


def iou(a: list[int], b: list[int]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = bbox_area(a) + bbox_area(b) - inter
    return inter / union if union else 0.0


def choose_anchor(
    mode: str,
    people: list[dict],
    faces: list[dict],
    plates: list[dict],
    food: list[dict],
    frame_w: int,
    frame_h: int,
) -> tuple[float, float, str]:
    if mode == "face" and faces:
        f = max(faces, key=lambda b: bbox_area(b["bbox"]))
        x, y = bbox_center(f["bbox"], 0.35)
        return x, y, "face"
    if mode == "plate":
        items = plates + food
        if items:
            p = max(items, key=lambda b: bbox_area(b["bbox"]))
            x, y = bbox_center(p["bbox"], 0.5)
            return x, y, "plate"
    if mode == "person" and people and (plates or food):
        person = max(people, key=lambda b: bbox_area(b["bbox"]))
        dish = max(plates + food, key=lambda b: bbox_area(b["bbox"]))
        px, py = _person_anchor(person, frame_w, frame_h)
        dx, dy = bbox_center(dish["bbox"], 0.5)
        return 0.55 * px + 0.45 * dx, 0.5 * py + 0.5 * dy, "person_plate"
    if people:
        p = max(people, key=lambda b: bbox_area(b["bbox"]))
        return (*_person_anchor(p, frame_w, frame_h), _person_anchor_name(p))
    if faces:
        f = max(faces, key=lambda b: bbox_area(b["bbox"]))
        x, y = bbox_center(f["bbox"], 0.35)
        return x, y, "face"
    items = plates + food
    if items:
        p = max(items, key=lambda b: bbox_area(b["bbox"]))
        x, y = bbox_center(p["bbox"], 0.5)
        return x, y, "plate"
    return frame_w / 2, frame_h / 2, "frame_center"


def _person_anchor(person: dict, frame_w: int, frame_h: int) -> tuple[float, float]:
    pose = person.get("pose") or {}
    if pose.get("center_x") is not None and pose.get("center_y") is not None:
        return pose["center_x"] * frame_w, pose["center_y"] * frame_h
    return bbox_center(person["bbox"], 0.35)


def _person_anchor_name(person: dict) -> str:
    pose = person.get("pose") or {}
    if pose.get("center_x") is not None:
        return "person_pose"
    return "person_bbox"


def suggested_shot(people: list[dict], faces: list[dict], has_plate_scene: bool, mode: str) -> str:
    if mode == "plate" and has_plate_scene and not people:
        return "plate"
    if people:
        person = max(people, key=lambda b: bbox_area(b["bbox"]))
        if person.get("is_full_body"):
            return "full"
        if faces:
            face = max(faces, key=lambda b: bbox_area(b["bbox"]))
            if bbox_area(face["bbox"]) > bbox_area(person["bbox"]) * 0.18:
                return "close"
        return "medium"
    if faces:
        return "close"
    if has_plate_scene:
        return "plate"
    return "medium"


def crop_score(anchor: str, has_person: bool, has_face: bool, has_plate_scene: bool, mode: str) -> float:
    score = 0.35 if has_person else 0.0
    score += 0.25 if has_face else 0.0
    if mode == "plate":
        score += 0.15 if has_plate_scene else 0.0
    elif has_plate_scene:
        score += 0.08
    if anchor != "frame_center":
        score += 0.15
    else:
        score -= 0.1
    if not has_person and not has_plate_scene and mode != "plate":
        score = min(score, 0.2)
    return round(max(0.0, min(1.0, score)), 2)


def ema(prev: float | None, new: float, alpha: float = 0.25) -> float:
    if prev is None:
        return new
    return alpha * new + (1 - alpha) * prev
