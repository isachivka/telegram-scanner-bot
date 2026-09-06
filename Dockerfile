# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    SCAN_TMP_DIR=/tmp/scanner-bot \
    SCAN_OUTPUT_DIR=/data/scans
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      sane-utils sane-airscan img2pdf cups-client ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/scans /tmp/scanner-bot
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY docker/entrypoint.sh /entrypoint.sh
VOLUME ["/data/scans"]
HEALTHCHECK --interval=60s --timeout=10s --start-period=20s --retries=3 \
  CMD sh -c 'if [ -n "$MCP_HTTP_PORT" ]; then node -e "fetch(\"http://127.0.0.1:$MCP_HTTP_PORT/healthz\").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; else exit 0; fi'
ENTRYPOINT ["tini", "--", "/entrypoint.sh"]
CMD []
