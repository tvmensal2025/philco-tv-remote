# CenaPronta — load tests

Never dump 10.000 heavy renders on production. Synthetic first. One real Casa for media regression.

```text
npm run build -w @reelops/shared
node scripts/load/synthetic-tenants.mjs
node scripts/load/tenant-fairness.mjs
node scripts/load/queue-load.mjs
node scripts/load/late-attempt.mjs
node scripts/load/api-load.mjs
```

`api-load.mjs` hits only `LOAD_API_BASE` (default `http://127.0.0.1:3000`) `/api/live` and `/api/ready`. If the local server is down it **skips** (exit 0) instead of attacking a public host.

| Script            | Jobs                  | External APIs   | Pass means                              |
| ----------------- | --------------------- | --------------- | --------------------------------------- |
| synthetic-tenants | 1.000 fake tenants    | none            | no cross-tenant media path leak         |
| tenant-fairness   | 500 flood + 100 small | none            | small tenant mean wait < flood          |
| queue-load        | 10.000 lightweight    | none            | all complete, scheduler finishes < 20s  |
| late-attempt      | 1 logical gate        | none            | A cannot promote after B owns execution |
| api-load          | 40×2 HTTP             | local Next only | p50/p95 recorded when server is up      |

## Not run from these scripts

- OpenAI / Gemini
- Revideo / FFmpeg
- Production Redis flood
- Worker-loss / MinIO-outage on the live VPS

## Capacity (measured on KVM4 Casa, not a forecast)

From real VPS Casa jobs:

- analysis/vision ~12s
- YOLO ~0.7–13s (warm vs cold)
- FFmpeg render ~25s
- wall ~40–60s / reel with concurrency 1

Conservative render worker: **~60 reels/hour/process** on that box. Lunch/dinner bursts need queue delay, not four parallel Revideos.
