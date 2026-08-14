# CenaPronta — pipeline de vídeo

O CenaPronta **não** é NVR. O fluxo começa no arquivo:

```text
CÂMERA / NVR → MP4 local → Uploader (watch imutável) → MinIO → recordings
  → Moment → RecordingLocator C1–C4 → VisionProvider REAL → VideoDirector
  → Composition (FFmpeg; Revideo atrás de flag) → Technical QC → Composition QC
  → READY → humano aprova → download
```

IA decide. Software executa. QC verifica. Humano aprova. QC pass **nunca** vira `approved`.

## Pipeline V1 (baseline protegido)

ReelPlanner + FFmpeg `renderVertical` HIGH → STANDARD → SAFE. Quatro programas: Casa, Ofício, Assinatura, Pulso. 1080×1920 H.264 AAC 30fps.

Não remover. V2 entra por cima: decisão versionada, manifesto, quality gates, renderer abstrato.

## Pipeline V2 (estado real)

| Peça                                                          | Classificação                                                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `VideoEditDecisionV1` (Zod, enums, ms relativos ao recording) | REAL no worker via `LegacyReelPlannerAdapter`                                                                                    |
| `CompositionRenderer` FFmpeg                                  | REAL (chama o render V1)                                                                                                         |
| `RevideoCompositionRenderer`                                  | REAL no canary Casa (`ENABLE_REVIDEO=true`, `REQUIRE_REVIDEO_RENDER=true`); estratégia `hybrid_ffmpeg_timeline_revideo_branding` |
| Technical QC                                                  | REAL no job (bloqueia `ready`) + fixture FFmpeg nos testes                                                                       |
| Composition QC                                                | REAL no job (logo/título/placeholder); templates V1 ainda sem overlay de logo                                                    |
| Visual AI QC                                                  | NOT ENABLED (`ENABLE_VISUAL_QC=false`)                                                                                           |
| Auto Repair                                                   | NOT ENABLED (`ENABLE_AUTO_REPAIR=false`)                                                                                         |
| ElevenLabs TTS                                                | REAL se `ENABLE_ELEVENLABS=true` + `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`; falha de TTS não derruba o Reel                 |
| Ducking voiceover                                             | REAL quando há TTS (`mixVoiceoverGraph` sidechain + amix)                                                                        |
| Music license                                                 | ARCHITECTURE READY (recusa `license unknown`; sem catálogo ainda)                                                                |

Canary Revideo: `ENABLE_REVIDEO=true` e programa Casa. Ofício/Assinatura/Pulso continuam FFmpeg por design. Fallback FFmpeg só se `REQUIRE_REVIDEO_RENDER` estiver off.

YOLO: adapter `apps/worker/src/adapters/yolo.ts` + serviço `yolo-service/`. Só entra no job se `ENABLE_YOLO=true` e `YOLO_URL` alcançável. Roda em frames JPEG do momento (≤2/câmera), não no recording inteiro. Tracking/SmartReframe/CutSafety/beat **não** estão implementados no worker.

## Contratos

- Schema: `packages/shared/src/video-decision.ts`
- Crop 9:16 sem stretch: `packages/shared/src/crop.ts` (`fitVertical1080x1920`)
- QC: `packages/shared/src/quality.ts`
- Manifesto: `packages/shared/src/render-manifest.ts` (gravado em `reels.metadata.render_manifest`)
- Brand: `restaurants.settings.videoBrand` JSON — sem colunas novas
- Falhas: TRANSIENT / PERMANENT / INPUT_ERROR / PROVIDER_ERROR / INFRA_ERROR / QUALITY_FAILURE

`sourceStartMs` / `sourceEndMs` são milissegundos **relativos ao início do recording**, teto 3_600_000. Timestamp Unix é rejeitado.

## FFmpeg vs Revideo

FFmpeg: probe, trim, crop, scale, concat, encode, áudio, thumbnail, Technical QC.

Revideo (quando REAL): tipografia, lower thirds, logo, CTA, ending. Fallback: Revideo → FFmpegCompositionRenderer. Registrar `composition_renderer_requested` / `used` / `fallback_reason`.

## ENV

Ver `.env.example`. Defaults: `ENABLE_REVIDEO=false`, `ENABLE_ELEVENLABS=false`, `ENABLE_VISUAL_QC=false`, `ENABLE_AUTO_REPAIR=false`. `VISION_PROVIDER` permanece; `VISION_PROVIDER_PRIMARY` é alias de preprocess. ElevenLabs usa `eleven_multilingual_v2` e `language_code=pt`; a narração entra por ducking sobre o áudio ambiente.

## Troubleshooting

| Sintoma                                         | O que fazer                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `TECHNICAL_QC:...`                              | O MP4 não vai a `ready`. Ver `reels.error_code`. Não é retry infinito.                  |
| `COMPOSITION_QC:...`                            | Asset/texto/logo fora da regra. V1 com `showLogo=false` não exige logo.                 |
| `Cannot allocate memory`                        | HIGH `eval=frame` Ken Burns. Downgrade STANDARD → SAFE. Job `ready` se o MP4 passar QC. |
| `COMPOSITION_UNAVAILABLE:revideo_not_installed` | Esperado com flag off / sem pacote. Fallback FFmpeg.                                    |
| Redis ECONNREFUSED                              | Health degraded. Moments 503. Não declare E2E PASS.                                     |
| `elevenlabs skipped` no log                     | TTS falhou; o Reel segue com áudio original. Ver chave, voice id e cota.                |
| Heuristic com `REQUIRE_REAL_VISION=true`        | Job falha. Não é Vision real.                                                           |

Documentação irmã: `docs/PRODUCTION_READINESS.md`, `docs/CAPABILITIES.md`, `docs/E2E_TEST.md`.
