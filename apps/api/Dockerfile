# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f apps/api/Dockerfile .
ARG NODE_IMAGE=node:24.14.1-alpine3.23

# ---- deps: full workspace install (dev + prod dependencies) ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/allocation/package.json packages/allocation/
RUN --mount=type=cache,target=/root/.npm npm install --no-audit --no-fund

# ---- dev: used by docker-compose.yml; source is bind-mounted over /app ----
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 3000
# Polling watcher: bind-mount file events are not delivered on Docker Desktop (Windows/macOS).
CMD ["npm", "run", "dev:poll", "-w", "@eas/api"]

# ---- build: compile shared packages first, then the API ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN npm run build -w @eas/shared -w @eas/allocation \
 && npm run build -w @eas/api

# ---- runtime: production dependencies only ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/allocation/package.json packages/allocation/
RUN --mount=type=cache,target=/root/.npm \
    npm install --omit=dev --no-audit --no-fund -w @eas/api \
 && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/allocation/dist packages/allocation/dist
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
