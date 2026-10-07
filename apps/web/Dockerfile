# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f apps/web/Dockerfile .
ARG NODE_IMAGE=node:24.14.1-alpine3.23
ARG NGINX_IMAGE=nginx:1.30.5-alpine

# ---- deps ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/allocation/package.json packages/allocation/
RUN --mount=type=cache,target=/root/.npm npm install --no-audit --no-fund

# ---- dev: Vite dev server with HMR; source is bind-mounted over /app ----
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 5173
CMD ["npm", "run", "dev", "-w", "@eas/web", "--", "--host", "0.0.0.0"]

# ---- build: Vite production build ----
FROM deps AS build
# Empty means same-origin (/api is routed to the API by the reverse proxy).
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN npm run build -w @eas/web

# ---- runtime: static files behind nginx ----
FROM ${NGINX_IMAGE} AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
