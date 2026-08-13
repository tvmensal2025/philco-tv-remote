# ReelOps

Produto multi-tenant para transformar momentos capturados por quatro câmeras de restaurante em Reels verticais. O sistema usa Supabase para autenticação e dados, Redis/BullMQ para filas, FFmpeg para renderização e o MinIO existente na VPS para mídia privada.

## O que já está pronto

- Login seguro por link de e-mail e callback PKCE.
- Onboarding que cria empresa, restaurante e quatro câmeras.
- Dashboard responsivo com status real das câmeras e jobs.
- Botão **Marcar Momento**, com janela anterior e posterior configurável.
- Recuperação de múltiplos segmentos por câmera, inclusive entre arquivos e meia-noite.
- Renderização 1080×1920 com áudio da câmera quando disponível.
- Biblioteca, player, download, aprovação, descarte e retry.
- Estilos Natural, Dinâmico e Cinematográfico.
- URLs temporárias para mídia privada; `/raw` nunca precisa ser público.
- Upload de NVR por URL assinada e confirmação de recebimento.
- Retenção automática do prefixo `/raw` no MinIO.
- Publicação opcional no Instagram profissional via Meta Graph API.
- Configuração, healthchecks, heartbeat do worker, rate limit e auditoria de estados.
- Docker, migrations automáticas e CI do GitHub.

## Arquitetura

```text
Câmeras / NVR
    ↓ segmentos MP4
ReelOps Ingest API → MinIO /raw
                         ↓
Supabase ← API web → Redis / BullMQ
                         ↓
                  Worker FFmpeg
                         ↓
             MinIO /generated/reels
                         ↓
             Revisão / exportação / Instagram
```

## Instalação na VPS

Pré-requisitos: Docker Engine com Compose, projeto Supabase e MinIO acessível pela VPS.

```bash
git clone SEU_REPOSITORIO reelops
cd reelops
cp .env.example .env
npm run key:generate
# edite o .env e cole a chave gerada em INGEST_API_KEY
npm run config:check
docker compose up -d --build
docker compose ps
```

O serviço `migrate` aplica os SQLs em ordem e registra cada migration em `public._reelops_migrations`. Ele encerra após concluir; isso é esperado.

Se as variáveis ainda estiverem com `CHANGE_ME`, o painel web inicia em modo de configuração e o worker aguarda as migrations. Preencha o `.env` e execute novamente `docker compose up -d --build`.

### Configurações obrigatórias

Abra `http://IP_DA_VPS:3000/setup` antes de preencher as ENVs. A página explica cada variável sem exibir segredos. Depois de configurado, o mesmo checklist fica em **Configurações**.

No Supabase, configure:

1. **Authentication → URL Configuration → Site URL:** o valor de `APP_URL`.
2. **Redirect URLs:** `APP_URL/auth/callback`.
3. **Settings → API:** copie Project URL, anon key e service role.
4. **Database → Connect:** copie a conexão direta em `SUPABASE_DB_URL`.

No MinIO:

- A conta informada deve poder criar/ler/gravar no bucket configurado.
- O worker cria o bucket se ele não existir.
- Com permissão de lifecycle, o worker aplica `RAW_RETENTION_DAYS` apenas em `/raw/`; sem ela, o processamento continua e a retenção deve ser criada no console do MinIO.
- Reels gerados não são apagados por essa regra.

Se o MinIO roda diretamente na VPS, use `MINIO_ENDPOINT=host.docker.internal`. Se estiver na mesma rede Docker com o nome `minio`, use `MINIO_ENDPOINT=minio`.

## Primeiro acesso

1. Abra o ReelOps e informe seu e-mail.
2. Clique no link recebido.
3. O onboarding pedirá empresa e primeiro restaurante.
4. Quatro câmeras são criadas automaticamente.
5. Em **Câmeras**, copie o ID do restaurante e os prefixos seguros.

## Enviar segmentos do NVR

O NVR deve produzir segmentos MP4 cujo timestamp represente o início real da gravação. Sincronize NVR, câmeras e VPS por NTP.

Preencher as ENVs conecta o software, mas o gravador também precisa enviar continuamente seus segmentos para esta API. O projeto fornece o protocolo e o cliente de referência abaixo; a forma de automatizar a chamada depende do modelo e software do seu NVR.

Se `MINIO_ENDPOINT` for `host.docker.internal`, ele serve apenas para os containers. Para o upload assinado funcionar em outra máquina, configure no NVR o mesmo nome por DNS/arquivo hosts apontando para a VPS, ou use em `MINIO_ENDPOINT` um hostname HTTPS que seja resolvível tanto pelos containers quanto pelo NVR.

Para testar um arquivo manualmente:

```bash
npm run segment:upload -- /videos/camera-1.mp4 RESTAURANT_UUID 1 2026-08-13T14:30:00.000Z
```

Fluxo de integração:

1. `POST /api/ingest/presign` com `Authorization: Bearer INGEST_API_KEY`.
2. Envie o MP4 por `PUT` para `uploadUrl`.
3. `POST completeUrl` com `cameraId`, `objectPath` e `capturedAt`.

Corpo da primeira chamada:

```json
{
  "restaurantId": "UUID_DO_RESTAURANTE",
  "cameraPosition": 1,
  "capturedAt": "2026-08-13T14:30:00.000Z",
  "contentType": "video/mp4"
}
```

O caminho final segue:

```text
raw/{tenant_id}/{restaurant_id}/camera-{posição}/YYYY/MM/DD/{timestamp_ISO}.mp4
```

`NVR_SEGMENT_SECONDS` precisa corresponder ao tamanho real do segmento produzido pelo NVR. Para reduzir a espera após clicar em **Marcar Momento**, prefira segmentos entre 15 e 30 segundos.

## Instagram opcional

Para habilitar **Publicar**, preencha:

- `META_ACCESS_TOKEN`
- `META_INSTAGRAM_ACCOUNT_ID`
- `MINIO_PUBLIC_ENDPOINT`

A conta deve ser profissional, vinculada a uma Página do Facebook e possuir as permissões exigidas pela Meta. O domínio público de mídia precisa ter HTTPS válido para que a Meta baixe a URL assinada. Sem essas variáveis, o produto oferece somente **Exportar MP4** e nunca finge que publicou.

## Operação

```bash
docker compose logs -f web worker
docker compose restart web worker
docker compose pull redis migrate
docker compose up -d --build
```

- Comece com `WORKER_CONCURRENCY=1` na KSM4.
- Mantenha Redis, MinIO e Supabase fora da internet pública sempre que possível.
- Coloque um proxy HTTPS (Caddy, Traefik ou Nginx) diante de `127.0.0.1:3000`.
- Faça backup do Supabase, Redis AOF e `/generated/reels`.
- Monitore `/api/health` pela tela de Configurações.

## Verificação antes de publicar código

```bash
npm ci
npm run typecheck
npm run build
npm run test:video
npm audit --omit=dev --audit-level=high
```

O teste de vídeo gera quatro câmeras sintéticas, renderiza um Reel 1080×1920 e confirma duração e áudio.

## Estados do job

```text
queued → collecting → analyzing → rendering → uploading → ready
                                                            ↓
                                      discarded ← approved → publishing → published
                         qualquer etapa → failed → retry → queued
```

Todas as transições são gravadas em `job_events`. O banco é a fonte de verdade; o Redis apenas executa o trabalho.

## Extensões futuras

- `SceneAnalyzer`: regras e estilos hoje; VLM, ReelScore, YOLO, BytePlus ou OpusClip depois.
- `Publisher`: Instagram hoje; outros canais por adaptadores.
- `source_type`: MinIO hoje; RTSP/NVR direto no futuro.

Segredos nunca devem ser colocados no navegador ou enviados ao GitHub. O `.gitignore` e o `.dockerignore` já protegem todos os arquivos `.env*`, exceto o exemplo sem credenciais.
