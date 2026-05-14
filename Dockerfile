FROM node:lts-bookworm-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:lts-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      sane-utils sane-airscan img2pdf ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
