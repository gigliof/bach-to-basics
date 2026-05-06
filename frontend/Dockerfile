# Bach to Basics: frontend image
# Multi-stage build: pnpm build, static files served by nginx with /api proxy

# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Workspace lockfile + manifests at the repo root drive deterministic installs.
# Build context is the repo root (see docker-compose.yml).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared ./shared
COPY frontend ./frontend

RUN pnpm install --frozen-lockfile --filter ./frontend...
RUN pnpm --filter frontend build

# ── Stage 2: serve ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
