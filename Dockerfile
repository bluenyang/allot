# Production image: ghcr.io/bluenyang/allot
# One Node process serves the built front end and the API, and applies migrations on start.
# The database is external (DATABASE_URL). See docker/compose.prod.yaml.

FROM node:26.13.0-alpine AS builder
RUN npm install -g pnpm@12.18.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm build:server

FROM node:26.13.0-alpine AS deps
RUN npm install -g pnpm@12.18.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:26.13.0-alpine
ENV NODE_ENV=production \
    TZ=Asia/Seoul \
    API_PORT=3000 \
    STATIC_DIR=/app/dist
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY drizzle ./drizzle
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "dist-server/index.mjs"]
