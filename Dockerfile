# The hub. Build the web app, then ship the server source as-is: Node 24 runs
# TypeScript directly, so the server has no build step. The CLI is not in this
# image; it is published as a binary per platform on each release.
FROM node:24.22.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24.22.0-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    INGEST_PORT=8081 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY src/server ./src/server
COPY src/shared ./src/shared
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8081/healthz || exit 1
CMD ["node", "--no-warnings=ExperimentalWarning", "src/server/main.ts"]
