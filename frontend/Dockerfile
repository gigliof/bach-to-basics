# Bach to Basics: frontend image
# Multi-stage build: pnpm build, static files served by nginx with /api proxy

# ── Stage 1: build ──────────────────────────────────────────────────────────
# Node 24 = active LTS (matches CI). Node 20 reached end-of-life in April 2026.
FROM node:24-alpine AS builder

# Corepack installs the exact pnpm version pinned in package.json's
# "packageManager" field (never "latest", which could break the lockfile).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

# Workspace lockfile + manifests at the repo root drive deterministic installs.
# Build context is the repo root (see docker-compose.yml).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared ./shared
COPY frontend ./frontend

RUN pnpm install --frozen-lockfile --filter ./frontend...
RUN pnpm --filter frontend build

# ── Stage 2: serve ──────────────────────────────────────────────────────────
# nginx stable branch (1.27 stopped receiving image updates in April 2025).
FROM nginx:1.30-alpine

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
