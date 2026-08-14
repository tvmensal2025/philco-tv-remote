FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PIP_NO_CACHE_DIR=1
ENV YOLO_MODEL=yolov8n.pt
ENV YOLO_POSE_MODEL=yolov8n-pose.pt
ENV YOLO_FACE_MODEL=yolov8n-face.pt
ENV YOLO_SEG_MODEL=yolov8n-seg.pt
ENV YOLO_CONF=0.35
ENV YOLO_MAX_SECONDS=20
ENV YOLO_FPS_SAMPLE=2
ENV PORT=8000

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py crop.py .

HEALTHCHECK --interval=60s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
