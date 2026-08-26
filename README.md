# elysia-mono

A Bun + Turborepo monorepo.

## What's inside?

### Apps and Packages

- `apps/web`: a [Vite](https://vite.dev/) + React app
- `packages/api`: a [Bun](https://bun.sh/) + [Elysia](https://elysiajs.com/) API with [MikroORM](https://mikro-orm.io/) (PostgreSQL) — see `packages/api/README.md` for details

Each package/app is 100% TypeScript.

### Utilities

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Prettier](https://prettier.io) for code formatting
- [Turborepo](https://turborepo.dev/) for task orchestration and caching

## Getting started

```sh
bun install
bun run dev
```

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
bunx turbo dev --filter=web
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
