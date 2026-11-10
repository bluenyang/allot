# Development image for web and api. Source is bind-mounted by compose;
# node_modules lives in the image (and a named volume) so host and container
# installs never mix.
FROM node:26.13.0-alpine

# Node 25+ no longer ships corepack, so install the pinned pnpm directly.
RUN npm install -g pnpm@12.18.0

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile

ENV TZ=Asia/Seoul
EXPOSE 15173
CMD ["pnpm", "exec", "vite", "--host", "0.0.0.0", "--port", "15173", "--strictPort"]
