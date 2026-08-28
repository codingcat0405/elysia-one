# elysia-mono

A Bun + Turborepo monorepo.

## What's inside?

### Apps and Packages

- `apps/client`: a [TanStack Start](https://tanstack.com/start) + React app — JWT auth (httpOnly cookies: access + refresh token pair), Zustand for global user state, Eden Treaty typed API client. See `apps/client/README.md` / `apps/client/AGENTS.md`.
- `packages/api`: a [Bun](https://bun.sh/) + [Elysia](https://elysiajs.com/) API with [MikroORM](https://mikro-orm.io/) (PostgreSQL) + BullMQ/Redis. See `packages/api/README.md` / `packages/api/AGENTS.md`.

Each package/app is 100% TypeScript. **AI agents and contributors: read `AGENTS.md` (root) before making cross-cutting changes** — it covers the FE/BE contract boundary that the two sub-`AGENTS.md` files don't individually own.

### Utilities

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Prettier](https://prettier.io) for code formatting
- [Turborepo](https://turborepo.dev/) for task orchestration and caching

## Getting started

```sh
bun install
cp packages/api/.env.example packages/api/.env   # fill in JWT_SECRET, DATABASE_URL, REDIS_URL
bunx turbo build --filter=api                    # once, so apps/client's Eden Treaty types resolve
bun run dev
```

The `turbo build --filter=api` step matters: `apps/client` gets its API types from `packages/api`'s built `dist/index.d.ts` (Eden Treaty), and `dist/` is gitignored — nothing builds it for you automatically before `dev`. Re-run it whenever `packages/api`'s routes or schemas change.

### Common commands

Run for all workspaces (via Turborepo):

```sh
bun run build
bun run dev
bun run lint
bun run check-types
```

Run for a single workspace with a [filter](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters):

```sh
bunx turbo dev --filter=client
bunx turbo check-types --filter=api
```

### Building the API's Docker image

`packages/api`'s `Dockerfile` uses `turbo prune` to pull a consistent, workspace-aware
dependency subset from the **root** `bun.lock` — so the build context must be the
repo root, not `packages/api/`:

```sh
docker build -f packages/api/Dockerfile -t api .
```

## Useful Links

- [Turborepo Tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks)
- [Turborepo Caching](https://turborepo.dev/docs/crafting-your-repository/caching)
- [Turborepo Configuration Options](https://turborepo.dev/docs/reference/configuration)
