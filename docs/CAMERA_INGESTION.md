# CenaPronta — ingestão de câmeras

O CenaPronta **não grava** câmeras, **não abre RTSP**, **não usa ONVIF**, **não controla NVR/PTZ** e **não chama API da câmera**.

O fluxo começa quando os arquivos aparecem em pastas:

```text
CÂMERA / NVR
  → arquivos de vídeo
  → pastas monitoradas
  → CenaPronta Uploader
  → MinIO
  → recordings (Supabase)
```

## Dois modos de pasta

`sourceMode` global e `sources[].mode` por pasta:

| Modo     | Quando usar                      | Depois do upload                                                                                  |
| -------- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `watch`  | Pasta do NVR                     | O arquivo **original permanece**. CenaPronta só lê, calcula hash, envia e grava estado no SQLite. |
| `outbox` | Pasta controlada pelo CenaPronta | Pode mover para `uploaded/` ou `failed/` (`moveOnSuccess` / `moveOnFailure`).                     |

## Persistência local

SQLite (`uploaded-files.sqlite`, tabela `uploaded_files`):

- não reenvia o mesmo checksum
- sobrevive a reinício e queda de energia
- guarda `attempts`, `last_error`, `retry_at`

Não use só JSON como fonte da verdade.

## TimestampResolver

O horário do segmento **não** é inventado em blocos de 2 minutos.

Ordem:

1. `FilenameTimestampResolver` — `cam-01_20260814T120000_20260814T120045.mp4` (`exact` / `filename`)
2. `NvrPatternTimestampResolver` — `sources[].filenamePattern` (regex com grupos `start`/`end`)
3. `FileMetadataTimestampResolver` — ffprobe `creation_time` + duration (`derived` / `file_metadata`)
4. `FallbackTimestampResolver` — mtime − duration (`fallback` / `filesystem_mtime`)

O recording guarda `timestamp_source` e `timestamp_confidence`.

## Arquivo pronto

- `FILE_STABLE_SECONDS` (padrão 3) e `FILE_STABLE_CHECKS` (padrão 3)
- ffprobe antes do PUT: container legível, `duration > 0`, pelo menos um video stream
- se falhar: retry, **não envia**

## Subir o uploader

```bash
copy apps\uploader\config.example.json apps\uploader\config.json
# preencha apiUrl, ingestKey, restaurantId e as pastas
npm run uploader
```

1. `POST /api/ingest/presign` com `INGEST_API_KEY`
2. `PUT` no MinIO
3. `POST /api/ingest/complete` → `recordings` + `idempotency_key`

## Upload avulso (dev)

```bash
node scripts/upload-segment.mjs arquivo.mp4 <restaurant_id> <posição> [ISO]
```
