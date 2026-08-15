# CenaPronta — arquitetura

```text
Restaurante                         VPS / EasyPanel                    Cloud
-----------                         ---------------                    -----
NVR grava MP4 em pastas             Next.js apps/web                   Supabase (Postgres + Auth + Realtime)
CenaPronta Uploader                 /api/ingest/presign|complete       Gemini / OpenAI (frames JPEG)
  watch: lê, não move               /api/moments                       Meta Graph (opcional)
  outbox: pode arquivar             /enviar (celular, sem HD)          WAME WhatsApp (opcional)
  RTSP na LAN (FFmpeg segmentos)    BullMQ + Redis
  SQLite uploaded_files             Worker FFmpeg + YOLO HTTP
  TimestampResolver                 MinIO bucket cenapronta
                                    worker_nodes identity/capabilities
```

## Pastas MinIO (canônico atual — não quebrar ingestão)

Não usamos `restaurants/{slug}/recordings/YYYY/MM/DD` nesta rodada. O layout vivo é:

```text
cenapronta/raw/{tenant}/{restaurant}/camera-N/{YYYY-MM-DD}/{ISO}.mp4
cenapronta/people/{tenant}/{restaurant}/{YYYY-MM-DD}/reels/{reelId}/reel.mp4
cenapronta/people/{tenant}/{restaurant}/{YYYY-MM-DD}/reels/01-titulo-xxxxxxxx.mp4
```

O dia da pasta é `America/Sao_Paulo`. O nome do arquivo é UTC ISO.

## O que roda onde

| Onde        | Processo                                                    |
| ----------- | ----------------------------------------------------------- |
| Restaurante | Câmeras, NVR, Uploader (`apps/uploader`)                    |
| VPS         | `apps/web`, `apps/worker`, Redis, MinIO                     |
| Supabase    | tenants, cameras, recordings, moments, reels, motion_events |
| Worker      | locate → frames → visão → plan → ffmpeg → upload            |
| Externo     | Gemini, Meta, WAME                                          |

## Filas BullMQ

`video-pipeline` (manual priority 1, motion 5), `segment-index`, `highlight-analyze`, `daily-digest`, `reel-publishing`.

Concorrência alvo KVM4: vídeo 1, análise/highlight 2, render 1.
