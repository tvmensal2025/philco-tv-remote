# CenaPronta E2E — vídeos públicos (2026-08-14 núcleo)

Simulação multicâmera **técnica**. Os quatro arquivos **não** filmam o mesmo evento real; só validam ingestão watch, timestamps sobrepostos, locator, visão real e os quatro programas.

Janela canônica: `2026-08-13T13:42:00-03:00` → `13:43:00` (13/08 porque 14/08 13:42 ainda era futuro às 03h e o `POST /moments` atrasaria o job até `windowEnd`).

Momento: `7d891f9f-a326-4066-95ba-62e8af577ecf` · `occurredAt` `2026-08-13T16:42:30Z` · janela 12s+8s.

## Resultado

**CENAPRONTA NÚCLEO — PASS (watch + OpenAI Vision, 2026-08-14)**

Gemini tentou e foi bloqueado (`API_KEY_SERVICE_BLOCKED`). O Worker registrou `gemini blocked; switching to configured real fallback` e usou `provider=openai`. HeuristicAnalyzer **não** entrou.

| Etapa                                                    | Resultado                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| Watch mode original intacto                              | PASS                                                         |
| Uploader presign → PUT → complete                        | PASS 4/4 `timestamp_source=filename` `confidence=exact`      |
| Recordings                                               | PASS 4/4 com checksum + idempotency_key                      |
| POST /api/moments                                        | PASS 1 momento, 4 reels                                      |
| RecordingLocator C1–C4                                   | PASS 24 frames (6 por câmera, 480px)                         |
| Vision                                                   | PASS OpenAI `gpt-4.1-mini` · ~10,8k tokens in                |
| Casa / Ofício / Assinatura / Pulso                       | PASS planos e durações distintos (18.3 / 20.3 / 18 / 15.8 s) |
| FFmpeg 1080×1920 h264+aac                                | PASS 4/4; JPEG extraído >50 KB (não preto)                   |
| MinIO people/.../reel.mp4                                | PASS                                                         |
| Aprovar Casa / descartar Ofício / retry Pulso / download | PASS                                                         |
| Uploader restart sem duplicar                            | PASS                                                         |
| Uploader offline                                         | PASS                                                         |

## Vídeos utilizados

| Cam | Papel    | Origem                                                                                                                                     | Licença       |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| C1  | MASTER   | [Making Khameeri Roti in Tandoor…](https://commons.wikimedia.org/wiki/File:Making_Khameeri_Roti_in_Tandoor_in_Turkman_Gate_Old_Delhi.webm) | CC BY-SA 4.0  |
| C2  | SIDE     | [Traditional kitchen in Northern Ghana](https://commons.wikimedia.org/wiki/File:Traditional_kitchen_in_Northern_Ghana.webm)                | ver Wikimedia |
| C3  | FOOD     | [Cooking with wok](https://commons.wikimedia.org/wiki/File:Cooking_with_wok.ogv)                                                           | CC BY-SA 4.0  |
| C4  | AMBIENCE | [Restaurante Caravela](https://commons.wikimedia.org/wiki/File:Restaurante_Caravela.webm)                                                  | CC BY 3.0     |

Arquivos locais: `test-assets/e2e/cam-0{1-4}.mp4` (gitignored).
