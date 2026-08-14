# EasyPanel worker: Build Path vazio, Dockerfile Path = Dockerfile.
# Contexto tem de ser a raiz do repo (package.json + apps/ + packages/).
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY scripts/patch-revideo-win32.mjs scripts/patch-revideo-win32.mjs
RUN npm ci
COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN npm run build -w @reelops/shared && npm run build -w @reelops/worker

FROM node:20-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/apps/worker/dist apps/worker/dist
COPY --from=build --chown=node:node /app/apps/worker/package.json apps/worker/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
RUN mkdir -p /tmp/reelops && chown node:node /tmp/reelops
USER node
CMD ["node", "apps/worker/dist/index.js"]
