# thinklocal-mcp Daemon Docker Image
# Multi-stage Build fuer minimale Image-Groesse

FROM node:22-slim AS builder

WORKDIR /app

# Dependencies zuerst (Cache-Layer)
COPY package.json package-lock.json ./
COPY packages/daemon/package.json packages/daemon/package-lock.json packages/daemon/
RUN cd packages/daemon && npm ci --production=false

# Source kopieren
COPY packages/daemon/src packages/daemon/src
COPY packages/daemon/tsconfig.json packages/daemon/
COPY config/ config/

# --- Runtime Stage ---
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    avahi-daemon avahi-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies und Source aus Builder
COPY --from=builder /app/packages/daemon /app/packages/daemon
COPY --from=builder /app/config /app/config
COPY package.json /app/

# Datenverzeichnis
RUN mkdir -p /data/thinklocal && chown -R node:node /data/thinklocal

USER node

ENV TLMCP_DATA_DIR=/data/thinklocal
ENV TLMCP_NO_TLS=1
ENV NODE_ENV=production

EXPOSE 9440

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:9440/health || exit 1

CMD ["node", "--import", "./packages/daemon/node_modules/tsx/dist/loader.mjs", \
     "packages/daemon/src/index.ts"]
