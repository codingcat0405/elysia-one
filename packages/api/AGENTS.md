# AGENTS.md

Guide for AI coding agents (Claude Code, Cursor, Copilot, Aider, ...) working in this repo. This is an Elysia + MikroORM + BullMQ template — several patterns here are load-bearing, not stylistic. Breaking them compiles fine and fails at runtime under concurrency, so read this before adding or changing code.

Read `README.md` first for the architecture overview. This file is the "don't break it" checklist.

## Non-negotiable invariants

### 1. Never touch the global `EntityManager` directly

`db.ts`'s `initORM()` returns one process-wide `{ orm, em }`. That `em` is **never** used to read/write data in request or job code — it exists only so `setup.ts` (`orm.em.fork()`) and job processors (`orm.em.fork()`) can derive per-unit-of-work forks from it.

- HTTP requests get their fork from `middlewares/setup.ts`'s `.derive()`.
- BullMQ jobs get their fork inline in the module's `worker.ts` (one `orm.em.fork()` per job — see `modules/user/worker.ts`).

If you're writing a query and typed `orm.em` instead of `em`/`userService` (or your new service), stop — that's the bug this template was hardened against. `grep -rn "orm.em" src` should only ever match `db.ts`, `setup.ts`, and the `orm.em.fork()` line inside each module's `worker.ts`.

### 2. Services are per-unit-of-work, never singletons

A service instance is constructed fresh inside `setup.ts`'s `.derive()` (for HTTP) for every single request, holding that request's `em`. Do **not**:
- Instantiate a service once at module load time and import the instance.
- Cache a service instance across requests/jobs.
- Give a service a longer lifetime than the `em` it holds.

Adding a new service = add a class taking `em` (and any other already-constructed services) via constructor, then add one line to `setup.ts`'s `.derive()` return object.

### 3. New controllers must `.use(setup)` (and `.use(authMacro)` if auth is needed) themselves

Elysia dedupes plugins by `name` (`setup` has `{ name: 'setup' }`), so calling `.use(setup)` in both `index.ts` and a controller is cheap and safe at runtime — it does not double-fork the `em`. But TypeScript resolves each file's context from its own composition chain, not its parent's. Skip `.use(setup)` in a new controller and `em`/`userService`-equivalents won't type-check inside it, even though it'd work at runtime because `index.ts` already composed it globally. Copy the pattern in `modules/user/index.ts`.

### 4. One Queue per domain module, dispatch by job name

Don't create a new BullMQ `Queue` per job type. Follow `modules/user/queue.ts`: one queue per module, job payload is a discriminated union keyed by `type`/`name`, and the module's `worker.ts` dispatches via `switch (job.name)`. Register every new module's `Worker` in the top-level `src/worker.ts` (a **separate process** — `bun worker`/`bun worker:dev` — never import/start a `Worker` from `index.ts` or any HTTP-path code).

Enqueue jobs only **after** the DB write that triggered them has flushed successfully (see `UserService.register` — enqueue happens after `em.flush()`, not before). Enqueuing first risks a job referencing a row that got rolled back.

### 5. Two Redis connections, never merge them

- `utils/redis.ts` (`getRedis()`) — shared singleton for `RedisCacheAdapter` and `RedisLock`. Retry-limited (`maxRetriesPerRequest: 3`) so a command fails fast during an outage instead of hanging.
- `utils/bull-connection.ts` — dedicated connection for BullMQ, **must** keep `maxRetriesPerRequest: null` (BullMQ requirement for its blocking commands; removing this breaks workers at startup).

If you add another Redis-backed feature, decide explicitly which client it needs — don't default to reusing `bullConnection` for non-BullMQ work or vice versa.

### 6. Errors: throw `HttpError` subclasses, don't hand-roll status codes

Services and macros throw from `utils/http-errors.ts` (`BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, or extend `HttpError` for a new one). `middlewares/errorMiddleware.ts` maps these automatically. Don't `set.status = ...; return {...}` inline in a handler for error cases — it bypasses the consistent `{ message, status }` shape and the "never leak internal errors" guarantee for the unmapped case (which falls through to a generic 500).

### 7. Return entities, define response schemas — don't hand-serialize

`middlewares/responseMiddleware.ts` converts any MikroORM entity (or array of entities) returned from a handler into a plain object via `wrap(entity).toObject()`, which drops `@Property({ hidden: true })` fields (e.g. `User.password`) automatically. Two rules follow:
- Return the entity itself from handlers; don't manually pick fields unless you need a shape the entity can't express.
- Still declare a `response` typebox schema per route (see `model.ts` files) — it's an independent guarantee against leaking fields if someone later removes `hidden: true` or adds a new sensitive column.

### 8. Schema is auto-synced, by design — don't add migrations

`index.ts` runs `orm.schema.updateSchema()` unconditionally on every boot, dev and prod. This is intentional for this project: change an entity, it syncs on next boot, no migration files. **Do not** add a `migrations` block to `mikro-orm.config.ts`, `migration:*` scripts, or migration files unless the user explicitly asks — `@mikro-orm/cli` being a devDependency is incidental, not a signal to build a migration workflow. Because there's no migration file to review before a schema diff applies, be extra careful with destructive entity changes (renaming/dropping a column/table) — the diff runs directly against whatever database is configured.

### 9. No in-process clustering — scale via replicas, not `node:cluster`

This template deliberately does **not** implement `node:cluster`/worker-thread scaling. Don't add it back without re-solving both reasons it was rejected:
- Deployments run on Kubernetes (or similar); replica count already gives horizontal scaling at the infra layer — an in-process cluster duplicates that.
- Bun's multi-instance-on-one-port mode doesn't reliably kill forked workers on dev-server stop/hot-reload, leaking background processes locally.

`DB_POOL_MAX` is a **per-process** pool; total Postgres connections = `replica count × DB_POOL_MAX`. Check that against Postgres `max_connections` when changing pool defaults or replica count — this is a deployment-config concern, not something read from an env var in this codebase.

### 10. Bull Board is Basic-Auth gated, not JWT — keep it that way

`/bull-board` uses `utils/basic-auth.ts` (constant-time `timingSafeEqual` compare) deliberately, because it's a browser-native dashboard, not an API client that already carries a bearer token. `index.ts` fails boot fast if `ENABLE_BULL_BOARD=true` without credentials set — preserve that fail-fast check if you touch boot-time env validation.

### 11. `export type App` (`index.ts`) is a public contract for `apps/client`

`apps/client` imports this type via `import type { App } from 'api'` and drives its Eden Treaty client off it (`apps/client/src/lib/eden-client.ts`) — that's the frontend's *only* type-safety net against the API's actual routes/schemas. Consequences:
- Don't remove or rename the `App` export, and don't change `main`'s return shape in a way that breaks it.
- A route path change, a `model.ts` body/response schema change, or a new/removed route is effectively an API contract change — treat it with the same care as changing a public function signature.
- The frontend only sees the *built* declaration (`dist/index.d.ts`, from `bun run build` / `tsc --emitDeclarationOnly`) — Turborepo's `dev` task has no `dependsOn: build`, so nothing rebuilds it automatically. After changing routes/schemas here, rebuild this package (or run `bunx turbo build --filter=api`) so `apps/client` isn't type-checking against a stale contract.

## Adding a new feature module (checklist)

Mirror `src/modules/user/`:

1. `modules/<name>/model.ts` — typebox request/response schemas.
2. `modules/<name>/service.ts` — plain class, `em` (and any dependency services) via constructor, throws `HttpError` subclasses.
3. `modules/<name>/index.ts` — Elysia controller: `.use(setup)`, `.use(authMacro)` if it needs auth, routes with `body`/`response` schemas from `model.ts`.
4. Register the new service in `middlewares/setup.ts`'s `.derive()`.
5. Mount the controller in `index.ts`'s `/api` group.
6. Only if the feature needs background work: `modules/<name>/queue.ts` (one `Queue`, discriminated job union) + `modules/<name>/worker.ts` (processor, `switch (job.name)`), then register the `Worker` in `src/worker.ts`.

## Before you finish

- Run `bun run check-types` (`bunx tsc --noEmit`) — this template has caught real bugs (missing `.js` extensions on dynamic `import()` under `NodeNext`, missing `.use(setup)` in a controller) exactly this way.
- There is no test suite yet (`bun test` is a placeholder). If you add one, don't silently skip it in CI — either wire it in for real or say explicitly that it doesn't exist.
- Don't add a new `.env` var without adding it to `.env.example` with a comment on when it's required.
