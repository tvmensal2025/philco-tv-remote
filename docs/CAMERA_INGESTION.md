# CenaPronta — ingestão de câmeras

O CenaPronta **não controla** NVR/PTZ. Ele entra quando existe um arquivo, um stream RTSP ou um envio pelo celular.

A **Sofia** só descobre aparelhos na LAN do restaurante (Uploader). Ela usa varredura de portas (554, 80, 8000, 34567) e um Probe ONVIF para **achar o gravador**. Não é controle PTZ.

```text
Sofia (Uploader na LAN)
  → acha o DVR / câmera IP
  → confirma senha no dashboard
  → RTSP canais 1–4
  → ou pasta C:\CenaPronta\cameras\C1–C4
  → ou /enviar no celular (iCSee / XMEye)
  → MinIO → recordings
```

RTSP **não roda na VPS**. A câmera está na LAN; o Uploader precisa estar na mesma rede.

Câmera analógica **não tem IP**. A Sofia acha o MHDX/NVR, não quatro pontos Wi-Fi.

## Sofia

1. Dashboard → Câmeras → **Achar as câmeras**
2. Uploader em `GET /api/ingest/sofia` recebe `scan`, varre a /24 e devolve discoveries
3. Dono confirma IP + senha (a senha vai para `sofia_secrets`, nunca para `sofia_sessions`)
4. Uploader prova RTSP por canal e grava em `cameras` + `camera_ingest_secrets`
5. Se não achar gravador: pasta do NVR ou Enviar no celular

## Dois modos de pasta

`sourceMode` global e `sources[].mode` por pasta:

| Modo     | Quando usar                      | Depois do upload                                                                                  |
| -------- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `watch`  | Pasta do NVR                     | O arquivo **original permanece**. CenaPronta só lê, calcula hash, envia e grava estado no SQLite. |
| `outbox` | Pasta controlada pelo CenaPronta | Pode mover para `uploaded/` ou `failed/` (`moveOnSuccess` / `moveOnFailure`).                     |
| RTSP     | Segmentos que o Uploader gravou  | Depois do upload o arquivo **é apagado** para o disco não encher.                                 |

Pasta padrão de muita instalação: `C:\CenaPronta\cameras\C1` … `C4`.

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
