# CenaPronta — scaling

This is a foundation document. It does **not** claim 1.000 restaurants in production.

```text
                         LOAD BALANCER
                              ↓
                    WEB / API (stateless replicas)
                              ↓
             ┌────────────────┼─────────────────┐
             ↓                ↓                 ↓
         PostgreSQL       Redis/BullMQ        MinIO
                              ↓
                       JOB QUEUES
          video-pipeline | segment-index | highlight | digest
                              ↓
                    WORKER PROCESS(ES)
          analysis + CV/YOLO HTTP + render (same binary today)
```

Future split is queue/capability based, not a rewrite:

- analysis-worker
- cv-worker (YOLO service already separate)
- render-worker

## What can scale horizontally today

| Piece             | Replica-safe?   | Notes                                                                                         |
| ----------------- | --------------- | --------------------------------------------------------------------------------------------- |
| Web/API           | Yes             | State in Postgres/Redis/MinIO. No sticky session.                                             |
| Worker processes  | Partial         | Stable `jobId=reelId`, execution lease, tenant render cap. Same binary still runs all queues. |
| YOLO HTTP service | Yes             | Keep model out of Node workers.                                                               |
| Redis             | No HA yet       | Single instance. Persistence expected; not Cluster.                                           |
| MinIO             | Source of media | DB cannot recover video if MinIO is gone. Replication is future.                              |

## Worker identity

Heartbeat `worker_nodes.metadata` now includes `WorkerDescriptor`:

- workerId, hostname, environment, deployment, version, pipelineVersion, startedAt, capabilities

Environment classification: explicit `WORKER_ENVIRONMENT`, else hostname heuristics (`Rafael` → development, Docker id → production).

Production health must not treat a live Windows worker as a live VPS worker.

## Concurrency

| Knob                                                     | Default       | Role                        |
| -------------------------------------------------------- | ------------- | --------------------------- |
| `VIDEO_WORKER_CONCURRENCY` / `RENDER_WORKER_CONCURRENCY` | cap 2         | heavy render                |
| `INDEX_WORKER_CONCURRENCY`                               | 2             | ingest index                |
| `HIGHLIGHT_WORKER_CONCURRENCY`                           | 1             | clip analysis               |
| `MAX_RENDER_JOBS_PER_TENANT`                             | 1             | noisy-neighbor cap          |
| `MAX_ACTIVE_JOBS_PER_TENANT`                             | 4             | reserved for later kinds    |
| `VISION_MAX_CONCURRENCY`                                 | 2             | in-process vision           |
| `YOLO_MAX_CONCURRENCY`                                   | 1             | in-process YOLO HTTP        |
| `FFMPEG_MAX_PROCESSES`                                   | 2             | FFmpeg child cap per worker |
| `YOLO_TIMEOUT_MS`                                        | 15000         | abort + center crop         |
| `STORAGE_QUOTA_BYTES_PER_TENANT`                         | 0 (unlimited) | domain ready; not billed    |

A moment still enqueues four programs. They wait in BullMQ. They do not all render at once on one KVM4 worker.

## Tenant fairness

Redis counter `cenapronta:tenant-active:render:{tenantId}`. Over cap → `moveToDelayed` + jittered delay. Fail-open if Redis fairness keys error so the fleet does not stall.

This is not BullMQ Pro groups. It is a testable cap.

## Exactly-once (product)

At-least-once execution + idempotent side effects:

- 1 logical job per reel (`jobId === reelId`)
- staging object `.../reels/{id}/.exec/{executionId}/reel.mp4`
- promote to canonical `.../reel.mp4` only if execution still owns the reel
- `setStatus ready` CAS on `metadata.execution_id`

## Redis HA (future)

Use managed Redis with persistence. Do not depend on Windows `redis-server.exe` for production. Do not implement Cluster in this codebase yet.

## Autoscaling signals (not implemented)

queue waiting, oldest waiting age, live production workers, render slots. EasyPanel/manual scale can use `/api/admin/health` and `/api/admin/queue`.
