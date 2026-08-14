# CenaPronta — prontidão de produção

O núcleo só está pronto quando o fluxo abaixo foi **provado**, não só quando o typecheck passa:

```text
pasta do NVR (watch, original intacto)
  → Uploader → MinIO → recordings
  → POST /api/moments (idempotente)
  → RecordingLocator C1–C4
  → VisionProvider REAL (OpenAI ou Gemini; não HeuristicAnalyzer)
  → Casa + Ofício + Assinatura + Pulso
  → FFmpeg sequencial (concurrency=1), perfis HIGH → STANDARD → SAFE
  → Dashboard assistir / aprovar / descartar / baixar
```

## READY vs HEALTH

| Endpoint          | Significado                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/ready`  | O processo Next aceita tráfego HTTP. Não testa Redis/MinIO/FFmpeg.                                                                       |
| `GET /api/health` | Dependências: Supabase, Redis, MinIO, Worker heartbeat, FFmpeg (`ffprobe -version` com timeout), VisionProvider, aviso de lifecycle raw. |

Orquestração Docker: liveness/readiness → `/api/ready`. Alerta de casa → `/api/health`.

Reinicie o Next antes de confiar no health: o processo antigo pode ter código em memória.

## Checklist KVM 4 (Hostinger)

| Item                           | Produção                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `VIDEO_WORKER_CONCURRENCY`     | `1`                                                                                                  |
| `RENDER_WORKER_CONCURRENCY`    | `1`                                                                                                  |
| `HIGHLIGHT_WORKER_CONCURRENCY` | `1`                                                                                                  |
| `INDEX_WORKER_CONCURRENCY`     | `2`                                                                                                  |
| `FFMPEG_THREADS`               | `2` (0 = default do FFmpeg; não hardcode sem medir)                                                  |
| `RENDER_PROFILE`               | `standard` na KVM 4. `high` tenta motion/`eval=frame` e faz downgrade sozinho.                       |
| `VISION_MAX_FRAMES`            | `4`                                                                                                  |
| `REQUIRE_REAL_VISION`          | `true`. Sem provider real o Reel **falha**; não inventa IA.                                          |
| `AUTH_BYPASS`                  | `false`. `true` só com `ALLOW_AUTH_BYPASS_IN_PRODUCTION=true`. Sem isso o processo **recusa** subir. |
| `SUPABASE_SERVICE_ROLE_KEY`    | Só web server e worker. Nunca `NEXT_PUBLIC_*`.                                                       |
| `ALLOW_STORAGE_SCAN_FALLBACK`  | `false`.                                                                                             |

Os 4 programas entram na mesma fila e **renderizam um de cada vez**. Não há 4 FFmpegs pesados em paralelo só porque existem 4 programas.

## FFmpeg — memória

O OOM do E2E veio de `takeFilter` HIGH: `scale=1480:2631` / `1296:2304` com **`eval=frame`** (Ken Burns) + `xfade` + `unsharp`/`noise`, vários inputs.

| Perfil   | Filtro                                | Quando                |
| -------- | ------------------------------------- | --------------------- |
| HIGH     | motion / punch / drift (`eval=frame`) | `RENDER_PROFILE=high` |
| STANDARD | crop / scale / cortes simples         | default KVM 4         |
| SAFE     | trim + concat + crop 1080×1920        | fallback automático   |

Se HIGH/STANDARD falhar por memória, o Worker desce para SAFE. MP4 válido → status **`ready`**, não `failed`. Metadata:

- `render_profile_used`: `high` \| `standard` \| `safe` \| `safe_fallback`
- `render_warning`: `MOTION_FILTER_MEMORY_FALLBACK` (ou `RENDER_PROFILE_DOWNGRADE`)

Isso aparece no log estruturado (`render`) e em `reels.metadata`.

## Visão

Ordem `VISION_PROVIDER=auto`: **OpenAI → Gemini → heuristic**. OpenAI não é “fallback de qualidade inferior”; é VisionProvider de primeira classe.

Gemini `API_KEY_SERVICE_BLOCKED` é estado **válido** de produção:

```text
Gemini: configured but blocked
OpenAI: active
Vision: REAL
```

Não bloqueie o deploy por causa do Google Cloud.

Logs de visão: `provider`, `model`, `vision_real=true/false`. Nunca a chave.

## Idempotência

- `POST /api/ingest/complete` com a mesma `idempotency_key` → 1 recording (`duplicate: true` na segunda).
- `POST /api/moments` com `clientRequestId` (UUID) → 1 momento / 4 reels. Duplo clique não gera 8.
- Frontend desabilita o botão e mostra **Gerando…** enquanto o request está em voo.
- Crash do worker no meio do render: BullMQ `jobId = reel.id`. Retry do mesmo job; não insere Reel duplicado.

## Redis / MinIO

- Redis offline: `POST /api/moments` devolve **503**. O momento **não** é criado. Não finge que o job entrou.
- MinIO offline no uploader: o arquivo original permanece na pasta watch; retry posterior. `complete` só roda depois do PUT OK.

## Uploader como serviço (Windows)

Não use `--once` em produção. Modo contínuo:

```bat
scripts\windows\start-uploader.cmd
```

Agendador de Tarefas (na inicialização) ou NSSM:

```bat
nssm install CenaProntaUploader "C:\Program Files\nodejs\node.exe" "C:\caminho\philco-tv-remote\apps\uploader\src\index.mjs"
nssm set CenaProntaUploader AppDirectory "C:\caminho\philco-tv-remote"
nssm start CenaProntaUploader
```

SIGINT / SIGTERM / `--once` fecham watchers, persistem o SQLite (sql.js) e só então `process.exit`.

## Disco temporário

`WORK_DIR` (`job-*`, `index-*`, `hl-*`): o job apaga no `finally`; o worker limpa leftovers na subida.

## Lifecycle raw 7 dias

O worker tenta aplicar a regra MinIO em `cenapronta/raw/`. Se a API recusar, `worker_nodes.metadata.rawLifecycle=unconfigured` e o health mostra **warning**. Não dependa de lifecycle silencioso.

## Benchmark (ambiente equivalente à KVM 4)

Máquina desta rodada (dev, **não** é a KVM 4): 12 threads (i5-13420H), 16 GB RAM, Windows. A KVM 4 Hostinger tem **4 vCPU / 16 GB** — por isso `VIDEO_WORKER_CONCURRENCY=1` e `FFMPEG_THREADS=2` mesmo neste notebook.

Corrida FFmpeg 4 programas **não reexecutada** nesta rodada: Redis em `127.0.0.1:6379` estava **fora** (ECONNREFUSED). O worker limpou `job-*` e ficou à espera do Redis; health voltou `degraded`.

| Programa    | Tempo | Peak RAM                                        | CPU                                   | Tamanho MP4           |
| ----------- | ----- | ----------------------------------------------- | ------------------------------------- | --------------------- |
| Casa        | —     | —                                               | —                                     | reusar E2E 2026-08-14 |
| Ofício      | —     | —                                               | —                                     | reusar E2E 2026-08-14 |
| Assinatura  | —     | —                                               | —                                     | reusar E2E 2026-08-14 |
| Pulso       | —     | —                                               | —                                     | reusar E2E 2026-08-14 |
| **Total 4** | —     | OOM evitado no E2E anterior via fallback concat | 2 workers sobrepostos no E2E anterior | 4/4 MP4               |

Quando o Redis local estiver no ar, repetir `e2e-core-watch` + `e2e-core-finish` com concurrency 1 e preencher esta tabela. Threads: 2 é o ponto de partida.

## Ainda P1 (não bloqueia o núcleo manual)

- Auto highlight gera só Assinatura, não os 4 programas.
- Motion ingest não dispara os 4 programas.

## Pipeline V2 (esta rodada)

Core V2 (Casa): `director_used=ai_v2`, `timeline_source=decision_v2`, `composition_renderer_used=revideo` (híbrido). Ofício/Assinatura/Pulso: AI Director V2 + FFmpeg. Ver `docs/video-pipeline.md`.

Não declare `CENAPRONTA VIDEO PIPELINE V2 FULLY VALIDATED` sem YOLO/tracking/SmartReframe reais **e** recovery crash sem job zumbi.

Recovery conhecido: `lockDuration` vídeo 15 min + `STALE_JOB_MS` 10 min. Job interrompido em `analyzing` pode ficar preso com lock zumbi; requeue usa `jobId` `${reelId}-recover-N` (risco de duplicar quando o lock expira).

## Não nesta rodada

Música de biblioteca, CTA de produção, editor de timeline, RTSP, ONVIF, PTZ, TikTok, YouTube, Temporal, AWS MediaConvert. YOLO existe como serviço separado mas **não** está ligado neste runtime (`ENABLE_YOLO=false`).
