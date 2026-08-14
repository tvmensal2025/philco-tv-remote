# CenaPronta YOLO

Microserviço CPU: detecta pessoa / pose / cena de prato e devolve um recorte **9:16** para o FFmpeg. Não gera o Reel.

Trechos típicos: **20 s** (janela Marcar Momento = 12 + 8). Sem GPU.

## EasyPanel — projeto `cenapronta`

Crie um **App** no **mesmo projeto** do worker (`cenapronta`). Nome do serviço: **`yolo`**. O hostname interno fica `yolo`.

Há duas fontes. A aba **Dockerfile** do EasyPanel **não aceita env**. Env vai em **Ambiente**.

### Aba Fonte → Dockerfile (sem Git)

Cole o conteúdo de `Dockerfile.easypanel` (gerado, autocontido). Esse arquivo **não** usa `COPY` do repo — o EasyPanel inline não vê `main.py`.

```bash
node yolo-service/build-easypanel-dockerfile.mjs
```

### Aba Fonte → Github (depois que `yolo-service/` estiver no Git)

| Campo           | Valor                           |
| --------------- | ------------------------------- |
| Repositório     | `tvmensal2025/philco-tv-remote` |
| Branch          | `main`                          |
| Build Path      | `yolo-service`                  |
| Builder         | Dockerfile                      |
| Dockerfile Path | `Dockerfile`                    |

Não use Github agora se a pasta `yolo-service` ainda não foi enviada ao `origin/main`.

### Runtime (qualquer fonte)

| Campo                      | Valor                                 |
| -------------------------- | ------------------------------------- |
| Porta do domínio (interno) | `8000`                                |
| Start command              | vazio (usa o CMD da imagem)           |
| GPU / NVIDIA               | **desligado**                         |
| Replicas                   | 1                                     |
| CPU limit                  | 1                                     |
| Memory limit               | 3072 MB                               |
| Volume                     | `yolo-weights` → `/root/.ultralytics` |

### Recursos (CPU, clip 20 s)

| Campo      | Valor                                       |
| ---------- | ------------------------------------------- |
| CPU        | 1.0                                         |
| RAM        | **3 GB** (mínimo 2 GB)                      |
| Swap extra | opcional, só ajuda no 1º download dos `.pt` |

20 s a 2 fps ≈ 40 frames. Nano em CPU ~80–150 ms/frame. Detect nos samples, pose/face só se houver pessoa: **~5–15 s** por câmera. Worker já é concorrência 1, então não empilha.

### Volume (obrigatório em produção)

Os pesos **não** vão no Git. Ultralytics baixa no primeiro request. Sem volume, cada redeploy baixa de novo.

| Mount                 | Path no container    |
| --------------------- | -------------------- |
| volume `yolo-weights` | `/root/.ultralytics` |

### Domínio

**Não publique** na internet. O worker chama na rede interna:

```text
http://yolo:8000
```

Health interno: `http://yolo:8000/health`

Se precisar testar do notebook, ligue o domínio `https://cenapronta-yolo.d9v63q.easypanel.host` **e** defina `YOLO_API_KEY`. Sem chave o POST fica aberto.

### Env do serviço `yolo`

```bash
PORT=8000
YOLO_MODEL=yolov8n.pt
YOLO_POSE_MODEL=yolov8n-pose.pt
YOLO_FACE_MODEL=yolov8n-face.pt
YOLO_SEG_MODEL=yolov8n-seg.pt
YOLO_CONF=0.35
YOLO_MAX_SECONDS=20
YOLO_FPS_SAMPLE=2
YOLO_API_KEY=
```

`yolov8n-face.pt` pode não existir no hub. O serviço sobe mesmo assim e estima o rosto pela pose. Seg não carrega no v1 (lazy, só se alguém chamar).

Para tentar YOLO26 depois: `YOLO_MODEL=yolo26n.pt` e os pares `-pose` / `-seg`. Se o download 404, volte para `yolov8n.pt`.

### Env do serviço **worker** (já existente)

```bash
YOLO_URL=http://yolo:8000
YOLO_API_KEY=
YOLO_TIMEOUT_MS=15000
```

Os dois serviços precisam estar no **mesmo projeto EasyPanel** para o DNS `yolo` resolver. Sem `YOLO_URL` o worker continua com center crop.

### Health

```bash
curl http://yolo:8000/health
```

Passou se `status=healthy` e `lazy_loading=true` **sem** ter baixado modelo ainda. O primeiro `/analyze-frame` demora (download + warmup). Os seguintes cabem nos 15 s.

## Local

```bash
docker compose --profile yolo up -d --build yolo
curl http://localhost:8000/health
python yolo-service/crop.test.py
```
