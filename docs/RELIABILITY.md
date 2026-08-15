# CenaPronta — reliability

## Liveness vs readiness

| Endpoint          | Meaning                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /api/live`   | Process is up.                                                                                               |
| `GET /api/ready`  | Process can take HTTP traffic. Does not probe Redis/MinIO.                                                   |
| `GET /api/health` | House alert: DB, Redis, MinIO, queue, **production** worker census. FFmpeg on the web host is informational. |

`NODE_ENV=production` requires at least one LIVE production worker. A development heartbeat cannot mask a dead VPS worker.

## Execution lease

Each video attempt creates `execution_id`. Only that claim can:

- `setStatus`
- promote staging → canonical MinIO object
- mark `ready`

Late attempt A after B took ownership throws `STALE_EXECUTION` (Unrecoverable). Retry is a new attempt on the **same** BullMQ `jobId` (reel id), never `reelId-recover-N`.

## Crash recovery

Reconcile every 60s: in-flight reels + `worker_nodes` heartbeat + BullMQ lock. Zombie → reclaim same job id. Missing → requeue same id. Cap `MAX_JOB_RECOVERIES`.

Graceful shutdown: stop timers, close BullMQ workers, delete own `worker_nodes` row, quit Redis, 25s force-exit.

## Provider failure

- Vision: classified errors (RATE_LIMIT, TIMEOUT, BLOCKED, 5XX). In-process semaphore + circuit (`VISION_CIRCUIT_OPEN`).
- YOLO: timeout (`YOLO_TIMEOUT`), 429 `YOLO_BUSY`, circuit after consecutive failures, health requires JSON `status` + `device` (empty HTTP 200 is not healthy). Optional center-crop fallback.
- FFmpeg: `FFMPEG_MAX_PROCESSES` semaphore around spawn.
- Redis down on expensive `POST /api/moments` and reel retry: fail closed (rate limiter) and existing queue 503.

## Storage

- RAW: `cenapronta/raw/` lifecycle, default 7 days (`RAW_RETENTION_DAYS`). Worker bootstrap applies the MinIO rule when permitted.
- TEMP: job dirs `job-*` deleted on success/failure and on worker boot.
- Delivery: canonical reel/thumbnail persist.
- Staging `.exec/{executionId}/` is not the public URL.

If MinIO dies, originals on the restaurant watch folder remain. Worker must not mark `ready` without a confirmed object.

## Rollback / kill switches

Keep V1. Disable without code deploy when env allows:

- `ENABLE_REVIDEO`
- `ENABLE_AI_DIRECTOR`
- `ENABLE_YOLO`
- `ENABLE_TRACKING`
- `ENABLE_SMART_REFRAME`

## What is not HA

Single Redis, single MinIO, no Kubernetes, no Temporal. Reliability here means leases, idempotency, fairness caps, and recovery — not multi-AZ failover.
