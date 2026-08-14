import { readFileSync, writeFileSync } from 'node:fs';

const crop = readFileSync(new URL('./crop.py', import.meta.url)).toString('base64');
const main = readFileSync(new URL('./main.py', import.meta.url)).toString('base64');

const dockerfile = `FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \\
    PYTHONDONTWRITEBYTECODE=1 \\
    PIP_NO_CACHE_DIR=1 \\
    YOLO_MODEL=yolov8n.pt \\
    YOLO_POSE_MODEL=yolov8n-pose.pt \\
    YOLO_FACE_MODEL=yolov8n-face.pt \\
    YOLO_SEG_MODEL=yolov8n-seg.pt \\
    YOLO_CONF=0.35 \\
    YOLO_MAX_SECONDS=20 \\
    YOLO_FPS_SAMPLE=2 \\
    PORT=8000

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \\
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libgomp1 curl \\
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \\
    fastapi==0.115.6 \\
    "uvicorn[standard]==0.34.0" \\
    python-multipart==0.0.17 \\
    "ultralytics>=8.3.250" \\
    opencv-python-headless==4.10.0.84 \\
    "Pillow>=10.4.0" \\
    "numpy>=1.26.0" \\
    "requests>=2.32.0" \\
    "pydantic>=2.10.0" \\
    "python-dotenv>=1.0.1"

RUN python -c "import base64,pathlib; pathlib.Path('crop.py').write_bytes(base64.b64decode('${crop}'))"
RUN python -c "import base64,pathlib; pathlib.Path('main.py').write_bytes(base64.b64decode('${main}'))"

EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=10s --start-period=60s --retries=3 \\
    CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
`;

writeFileSync(new URL('./Dockerfile.easypanel', import.meta.url), dockerfile);
console.log(`wrote Dockerfile.easypanel (${dockerfile.length} bytes)`);
