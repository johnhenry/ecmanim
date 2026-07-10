# ecmanim render service — coordinator or worker (pick via the command).
#
#   docker build -t ecmanim-service .
#   docker run -v ./my-project:/project:ro -p 5990:5990 \
#     -e ECMANIM_API_TOKEN=... -e ECMANIM_WORKER_TOKEN=... \
#     ecmanim-service serve --project /project --host 0.0.0.0
#   docker run -v ./my-project:/project:ro \
#     -e ECMANIM_WORKER_TOKEN=... \
#     ecmanim-service worker --coordinator http://coordinator:5990 --project /project
#
# The image ships ffmpeg + fonts + the compiled CLI. It deliberately ships NO
# Chrome: render.renderer=webgl jobs are rejected (400) by the service v1 —
# a Chrome sidecar image is the documented future path for renderGL.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.bin.json ./
COPY src ./src
COPY bin ./bin
RUN npm run build

FROM node:24-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-noto-core \
    fonts-dejavu-core \
    curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# Production deps only — but KEEP optionalDependencies (@napi-rs/canvas is
# the raster backend; three/yoga stay available for scenes that use them).
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist

# Coordinator state (queue.db + artifacts) lives here; mount a volume to
# persist it across container restarts.
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS "http://127.0.0.1:${PORT:-5990}/healthz" || node dist/bin/ecmanim.js checkhealth || exit 1

ENTRYPOINT ["node", "dist/bin/ecmanim.js"]
CMD ["serve", "--project", "/project", "--host", "0.0.0.0", "--data", "/data"]
