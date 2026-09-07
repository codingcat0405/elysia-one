# Build from the MONOREPO ROOT, not this directory:
#   docker build -f apps/client/Dockerfile -t client .
#
# Mirrors packages/api/Dockerfile's turbo-prune pattern (same reasoning: the
# pruned lockfile needs the whole workspace). One real difference from that
# Dockerfile: the API runs its TS source directly under Bun, so its image
# never needs a build step. This image runs Vite's PRODUCTION build output
# (dist/server/server.js), so this Dockerfile actually invokes `bun run
# build` inside the image — and the install stage cannot use
# `--production`, because `vite build` itself needs devDependencies
# (vite, @vitejs/plugin-react, tailwindcss, etc).

FROM oven/bun:1.3.13-slim AS base

# ---- prune: extract only what `client` needs from the monorepo ----
FROM base AS pruner
WORKDIR /app
COPY . .
RUN bunx turbo prune client --docker

# ---- install: reproducible install from the pruned workspace lockfile.
# Full install (not --production) — vite build needs devDependencies.
FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN bun install --frozen-lockfile

# ---- build ----
# VITE_API_URL is a Vite BUILD-TIME value, baked into both the browser
# bundle and the SSR server bundle at this step — it is NOT read from the
# environment at container runtime, unlike every env var in
# packages/api/Dockerfile. Override it with --build-arg if the
# browser-reachable API origin differs from the default (e.g. a real
# domain in a non-local deployment). See root docker-compose.yml for how
# this interacts with the SSR-vs-browser addressing split.
FROM installer AS builder
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
COPY --from=pruner /app/out/full/ .
RUN bunx turbo build --filter=client

# ---- runtime ----
# Not a lean --production-only reinstall (unlike the API image) — the
# builder's full node_modules is carried forward as-is because it's
# unclear which of Vite's devDependencies the bundled server actually
# needs at runtime vs. only at build time without auditing rollup's
# externals list. Correctness over image size for this first pass; slim
# it down later with a dedicated production-only install stage if image
# size becomes a real concern.
FROM base AS runner
WORKDIR /app
COPY --from=builder /app/ .

ENV NODE_ENV=production
# app listens on PORT — keep EXPOSE in sync. NOT 3000: that's the API's
# port, and both containers can share a Docker network / host port space.
ENV PORT=3001
EXPOSE 3001

# don't run as root; `bun` user ships with the base image
USER bun

WORKDIR /app/apps/client
CMD ["bun", "run", "dist/server/server.js"]
