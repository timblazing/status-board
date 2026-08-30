# ---- build ----
# Pinned to the builder's native architecture: the output is plain JS, so it is
# the same for every target platform and never has to run under QEMU. Only the
# small runtime stage below is emulated per-platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json vite.config.ts build-server.mjs ./
COPY server ./server
COPY web ./web
RUN npm run build

# ---- runtime ----
# Only the built client and the bundled server ship; no node_modules.
FROM node:24-alpine
WORKDIR /app

# The board holds a few KB of history; V8's default heap is far larger than
# this workload ever needs, so cap it to keep the container small.
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=96 \
    CONFIG_PATH=/config/config.yaml \
    STATIC_DIR=/app/dist

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

USER node
EXPOSE 8080
VOLUME ["/config"]

# HEALTHCHECK_PORT must match the `port:` in config.yaml if you change it.
ENV HEALTHCHECK_PORT=8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.HEALTHCHECK_PORT+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist-server/index.js"]
