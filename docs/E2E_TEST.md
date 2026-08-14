# CenaPronta — teste E2E do momento real

Prova exigida:

pasta watch (original intacto) → Uploader → MinIO → recordings → `POST /api/moments` → C1–C4 → Vision REAL → 4 programas → FFmpeg → dashboard.

## Preparar

1. `npm run dev` (web + worker). Redis em `127.0.0.1:6379` ou EasyPanel.
2. Aplicar `supabase/migrations/0013_recording_timestamp_idempotency.sql` e `0014_moment_client_request_id.sql`.
3. Desenvolvimento: `AUTH_BYPASS=true` explícito. Produção: `AUTH_BYPASS` ausente. `NODE_ENV=production` + `AUTH_BYPASS=true` sem emergência → processo não sobe.
4. Worker: `REQUIRE_REAL_VISION=true`, `VIDEO_WORKER_CONCURRENCY=1`, `RENDER_WORKER_CONCURRENCY=1`, `FFMPEG_THREADS=2`, `RENDER_PROFILE=standard`.
5. Copiar 4 arquivos para pastas **watch** (não outbox de NVR) com nomes canônicos:

```text
cam-01_20260813T134200_20260813T134300.mp4
cam-02_20260813T134200_20260813T134300.mp4
cam-03_20260813T134200_20260813T134300.mp4
cam-04_20260813T134200_20260813T134300.mp4
```

6. `node apps/uploader/src/index.mjs --once`
7. Confirmar que os quatro arquivos **continuam na pasta original**.
8. `POST /api/moments` com `occurredAt` dentro da janela e `clientRequestId` (UUID). Um segundo POST com o mesmo id deve devolver o mesmo momento.
9. Acompanhar Casa / Ofício / Assinatura / Pulso até `ready` (FFmpeg **sequencial**).
10. Assistir, aprovar um, descartar outro, retry controlado, baixar e `ffprobe`.
11. `GET /api/ready` e `GET /api/health` **depois de reiniciar o Next**.
12. `npm run build -w @reelops/web` (`next build` PASS).

Scripts desta rodada:

```bash
node scripts/e2e-public-bootstrap.mjs
node scripts/e2e-core-watch.mjs
node scripts/e2e-core-finish.mjs
node scripts/e2e-uploader-modes.mjs
node scripts/e2e-ingest-idempotency.mjs
```

## Visão

- HeuristicAnalyzer = **FAIL**.
- Se Gemini estiver bloqueado e OpenAI configurada, o log deve dizer `provider=openai`.

Relatório do teste público: `docs/E2E_PUBLIC_VIDEO_TEST.md`.
Prontidão: `docs/PRODUCTION_READINESS.md`.
Pipeline V2: `docs/video-pipeline.md`.

E2E V2 desta máquina (2026-08-14, momento `20536926-cac2-4ed4-a2f6-1d739641eb3a`): Casa `requested=revideo` `used=revideo`; Ofício/Assinatura/Pulso FFmpeg; Vision OpenAI real; watch checksum intacto. Crash recovery do job Casa em `analyzing` **não** reencaminhou em 3 min (`lockDuration` 15 min). YOLO real **NOT RUN**.
