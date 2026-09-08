# elysia-mono

A Bun + Turborepo monorepo.

## What's inside?

### Apps and Packages

- `apps/client`: a [TanStack Start](https://tanstack.com/start) + React app — Better Auth (username/password + Google OAuth, httpOnly session cookie), Zustand for global user state, Eden Treaty typed API client. See `apps/client/README.md` / `apps/client/AGENTS.md`.
- `packages/api`: a [Bun](https://bun.sh/) + [Elysia](https://elysiajs.com/) API with [MikroORM](https://mikro-orm.io/) (PostgreSQL) + BullMQ/Redis. See `packages/api/README.md` / `packages/api/AGENTS.md`.

Each package/app is 100% TypeScript. **AI agents and contributors: read `AGENTS.md` (root) before making cross-cutting changes** — it covers the FE/BE contract boundary that the two sub-`AGENTS.md` files don't individually own.

### Utilities

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [oxlint](https://oxc.rs/docs/guide/usage/linter.html) for code linting
- [Prettier](https://prettier.io) for code formatting
- [Turborepo](https://turborepo.dev/) for task orchestration and caching

## Getting started

```sh
bun install
cp packages/api/.env.example packages/api/.env   # fill in BETTER_AUTH_SECRET, DATABASE_URL, REDIS_URL
bunx turbo build --filter=api                    # once, so apps/client's Eden Treaty types resolve
bun run dev
```

The `turbo build --filter=api` step matters: `apps/client` gets its API types from `packages/api`'s built `dist/index.d.ts` (Eden Treaty), and `dist/` is gitignored — nothing builds it for you automatically before `dev`. Re-run it whenever `packages/api`'s routes or schemas change.

**Google sign-in (optional).** Create an OAuth 2.0 Client ID at <https://console.cloud.google.com/apis/credentials>, add `http://localhost:3000/api/auth/callback/google` as an Authorized redirect URI, and set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in `packages/api/.env`. Both or neither — the API refuses to boot with only one. Skip this entirely to run with username/password only.

### Common commands

Run for all workspaces (via Turborepo):

```sh
bun run build
bun run dev          # api (HTTP) + client — does NOT start the background worker
bun run dev:worker   # BullMQ worker (packages/api/src/worker.ts), separate process
bun run lint
bun run check-types
bun run test         # packages/api's tests need Postgres + Redis reachable (real .env)
```

Format code (root-only, not via Turborepo):

```sh
bun run format       # prettier --write .
bun run format:check # prettier --check .
```

Use `bun run test`, not a bare `bun test` from the repo root — the latter recursively finds test files across both workspaces but loads env relative to the root (where there's no `.env`), so `packages/api`'s DB-backed tests fail before Postgres/Redis even matter. See `packages/api/README.md`'s "Testing" section.

Run for a single workspace with a [filter](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters):

```sh
bunx turbo dev --filter=client
bunx turbo check-types --filter=api
```

### Docker

Two ways to run this in Docker, depending on what you need:

**Full local stack** (`postgres` + `redis` + `api` + `worker` + `client`) via `docker-compose.yml` at the repo root:

```sh
cp .env.example .env   # fill BETTER_AUTH_SECRET (openssl rand -base64 48)
docker compose up --build
```

Then open `http://localhost:3001`. Postgres/Redis are **not** published to the host by default (only reachable by other containers, via Compose's internal service-name DNS) — this avoids "port already in use" against a local Postgres/Redis you might already be running for `bun dev`. Add a `ports:` block back to either service in `docker-compose.yml` if you want host-side access (e.g. `psql -h localhost -p 5433`) for debugging the containerized DB specifically — use a non-5432/6379 host port to avoid exactly that collision. `apps/client`'s container runs with `network_mode: host` (Linux only) — see `docker-compose.yml`'s own comment for why (short version: `VITE_API_URL` is baked into the client bundle at build time and is used by both the browser and the container's own SSR fetches, which need different addressing on a normal bridge network — host networking sidesteps that for local testing). This is a pragmatic local-testing setup, not a production deployment topology.

**Just the API image**, standalone (e.g. to push to a registry, or run against infra you already have):

`packages/api`'s `Dockerfile` uses `turbo prune` to pull a consistent, workspace-aware
dependency subset from the **root** `bun.lock` — so the build context must be the
repo root, not `packages/api/`:

```sh
docker build -f packages/api/Dockerfile -t api .
```

`apps/client/Dockerfile` follows the same `turbo prune` pattern (`docker build -f apps/client/Dockerfile -t client .`), but additionally runs `vite build` inside the image — see that Dockerfile's comments for the `VITE_API_URL` build-arg it needs and why.

## Useful Links

- [Turborepo Tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks)
- [Turborepo Caching](https://turborepo.dev/docs/crafting-your-repository/caching)
- [Turborepo Configuration Options](https://turborepo.dev/docs/reference/configuration)
