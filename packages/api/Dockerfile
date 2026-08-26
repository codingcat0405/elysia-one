# Build from the MONOREPO ROOT, not this directory:
#   docker build -f packages/api/Dockerfile -t api .
#
# `turbo prune` needs the whole workspace (root package.json + root bun.lock)
# to produce a correct, reproducible subset for `api` — that's why the build
# context is the repo root instead of packages/api/.

FROM oven/bun:1.3.13-slim AS base

# ---- prune: extract only what `api` needs from the monorepo ----
FROM base AS pruner
WORKDIR /app
COPY . .
RUN bunx turbo prune api --docker

# ---- install: reproducible install from the pruned workspace lockfile ----
FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN bun install --frozen-lockfile --production

# ---- runtime ----
FROM base AS runner
WORKDIR /app
COPY --from=installer /app/ .
COPY --from=pruner /app/out/full/ .

ENV NODE_ENV=production
# app listens on PORT (default 3000) — keep EXPOSE in sync
ENV PORT=3000
EXPOSE 3000

# don't run as root; `bun` user ships with the base image
USER bun

WORKDIR /app/packages/api
CMD ["bun", "run", "src/index.ts"]
