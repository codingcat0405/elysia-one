# Elysia Forge - Elysia + MikroORM + BullMQ template

Production-hardened Bun backend: Elysia (HTTP), MikroORM/PostgreSQL (data), BullMQ/Redis (background jobs), Winston (logging), JWT auth, optional `node:cluster` scaling.

## Quick start

```bash
cp .env.example .env   # fill JWT_SECRET (openssl rand -base64 48) and DATABASE_URL
bun install
bun dev                 # watch mode; schema auto-sync on boot (see "Schema" below)
```

- Swagger UI: `http://localhost:3000/swagger-ui` (auto-enabled outside production; opt in for prod with `ENABLE_SWAGGER=true`)
- Bull Board (job dashboard): `http://localhost:3000/bull-board`, opt in with `ENABLE_BULL_BOARD=true` + `BULL_BOARD_USER`/`BULL_BOARD_PASSWORD` (HTTP Basic Auth, not JWT)
- Background worker (BullMQ), separate process: `bun worker:dev`

Docker:

```bash
docker build -t elysia-template .
docker run -p 3000:3000 --env-file .env -e NODE_ENV=production elysia-template
```

**Full rules for anyone (human or AI agent) extending this template: see [`AGENTS.md`](./AGENTS.md).**

## Architecture

Feature-based modules. Per-request `EntityManager` fork happens via Elysia `.derive()` in `setup.ts` — no `RequestContext`/AsyncLocalStorage.

```
src/
  index.ts                    # boot: env checks, schema sync, cluster fork, graceful shutdown
  server.ts                   # composes the Elysia app (single process / single cluster worker)
  worker.ts                   # separate process: BullMQ Worker(s), no HTTP server
  db.ts                       # cached initORM() — one MikroORM instance per process
  mikro-orm.config.ts         # driver, pool, result-cache adapter config
  bull-board.ts               # /bull-board dashboard plugin, Basic-Auth gated

  middlewares/
    setup.ts                  # per-request: em.fork() + service instances (the core pattern)
    responseMiddleware.ts     # auto-serializes MikroORM entities, strips `hidden` props
    errorMiddleware.ts        # maps HttpError / validation / 404 -> JSON, else generic 500

  macros/
    auth.ts                   # `checkAuth(roles)` macro: verifies JWT, injects `user`

  modules/
    user/
      index.ts                # Elysia controller (routes)
      model.ts                # typebox request/response schemas
      service.ts               # plain class, em injected via constructor
      queue.ts                # BullMQ Queue for this module's jobs
      worker.ts                # job processor(s) for this module's queue

  entities/                   # shared MikroORM entities (BaseEntity, User, ...)

  utils/
    http-errors.ts             # framework-free HttpError classes
    logger.ts                  # winston: pretty dev / JSON prod
    redis.ts                   # shared ioredis client (cache adapter, lock)
    bull-connection.ts        # DEDICATED ioredis connection for BullMQ
    RedisCacheAdapter.ts       # MikroORM result-cache adapter (Redis-backed)
    RedisLock.ts               # SET NX PX + Lua-script distributed lock
    basic-auth.ts              # HTTP Basic Auth guard (Bull Board), timing-safe compare
```

### The rules that keep MikroORM happy

1. **One `em.fork()` per unit of work** — per HTTP request (`setup.ts`) and per BullMQ job (`modules/*/worker.ts`). Same discipline both places.
2. **Never use the global `orm.em` in modules** — only the derived `em` / services. Grep for `orm.em` outside `db.ts`, `setup.ts`, and job processors in review.
3. **Services are per-request instances, not singletons** — an app-lifetime object must never hold a request-lifetime `em`.
4. Controllers `.use(setup)` (and `.use(authMacro)` if they need auth) themselves — Elysia dedupes the plugin by name at runtime, but each file is typechecked on its own composition chain, so the context types (`em`, `userService`, `user`) only resolve if the file declares the `.use()` itself.

### Schema: auto-sync, no migrations (intentional)

`index.ts` runs `orm.schema.updateSchema()` unconditionally on every boot — dev **and** prod, single **and** cluster mode (once, in the primary, before forking workers). This is deliberate for this project: schema changes ship by changing entities, not by writing/running migration files. There is no `migrations` block in `mikro-orm.config.ts` and no `migration:*` scripts in `package.json` — don't add them unless explicitly asked; `@mikro-orm/cli` being present is incidental (transitive dep), not a signal to wire up migrations.

If you change an entity, `updateSchema()` picks it up on next boot — no extra step needed. Keep this in mind for destructive changes (renaming/dropping a column): auto-sync applies the diff directly, there's no migration file to review before it runs against a real database.

### Pool sizing

Per-process pool via `DB_POOL_MAX` (default 10). With `WORKER_THREADS` cluster mode: `total connections = workers × DB_POOL_MAX` — keep it under Postgres `max_connections` with headroom, or put pgBouncer in front.

### Background jobs (BullMQ)

- One **Queue per domain module** (e.g. `modules/user/queue.ts`), not one queue per job type — job data is a discriminated union (`{ type: '...' }`), dispatched via `switch (job.name)` in the module's `worker.ts`.
- Register every module's `Worker` in the top-level `src/worker.ts` — that's a **separate process** (`bun worker`/`bun worker:dev`), never started inside the HTTP server process.
- `utils/bull-connection.ts` is a **dedicated** ioredis connection (`maxRetriesPerRequest: null`, required by BullMQ's blocking commands). Never reuse the shared `utils/redis.ts` client for BullMQ, and vice versa.
- Enqueue jobs **after** the triggering DB write (`em.flush()`) succeeds — never enqueue for a row that might still roll back (see `UserService.register`).

### Bull Board dashboard

Mounted at `/bull-board`, gated by HTTP Basic Auth (`utils/basic-auth.ts`, constant-time compare) — deliberately not the app's JWT, since this is a browser-native dashboard, not an API client. Boot fails fast (`index.ts`) if `ENABLE_BULL_BOARD=true` but `BULL_BOARD_USER`/`BULL_BOARD_PASSWORD` aren't set. Exposes internal job payloads — never expose this publicly without auth.

### Redis: two separate clients, on purpose

| Client | File | Used by | Notes |
|---|---|---|---|
| Shared client | `utils/redis.ts` (`getRedis()`) | `RedisCacheAdapter`, `RedisLock` | Singleton, retry-limited, safe for normal commands |
| Dedicated client | `utils/bull-connection.ts` | BullMQ `Queue`/`Worker` | `maxRetriesPerRequest: null`, required for blocking ops |

If `REDIS_URL` is unset, MikroORM falls back to `MemoryCacheAdapter` (per-process, not shared) — fine for dev, not for multi-instance prod caching consistency.

### Error handling

Services/macros throw `HttpError` subclasses (`utils/http-errors.ts`): `BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`. `errorMiddleware` maps these to their status + message; Elysia `VALIDATION`/`NOT_FOUND` codes are special-cased; anything else is logged server-side and returns a generic 500 (never leaks internal error text to clients).

### Response serialization

`responseMiddleware` auto-converts MikroORM entities (single or array) returned from handlers into plain objects via `wrap(entity).toObject()`, which also strips any `@Property({ hidden: true })` field (e.g. `User.password`). Return entities directly from handlers — don't hand-roll serialization, and don't skip the `response` typebox schema on routes (it's the second guarantee against leaking fields, independent of `hidden`).

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP port |
| `DATABASE_URL` | **yes** | — | Postgres connection string |
| `JWT_SECRET` | **yes** | — | Boot fails fast if missing |
| `JWT_EXPIRES_IN` | no | `1d` | jsonwebtoken `expiresIn` |
| `DB_POOL_MIN` / `DB_POOL_MAX` | no | `0` / `10` | Per-process pool; multiply by workers in cluster mode |
| `DB_POOL_ACQUIRE_TIMEOUT_MS` | no | `10000` | Fail fast instead of hanging |
| `DB_POOL_IDLE_TIMEOUT_MS` | no | `30000` | Keep under infra idle timeouts |
| `WORKER_THREADS` | no | `1` | `>1` enables `node:cluster` mode |
| `ENABLE_SWAGGER` | no | auto outside prod | Set `true` to force-enable in prod |
| `REDIS_URL` | conditionally | — | Required if running the worker (`bun worker`); optional for cache/lock (falls back to in-memory) |
| `WORKER_CONCURRENCY` | no | `5` | Jobs processed in parallel, per worker process |
| `ENABLE_BULL_BOARD` | no | `false` | If `true`, `BULL_BOARD_USER`/`PASSWORD` become required |
| `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD` | conditionally | — | HTTP Basic Auth for `/bull-board` |
| `NODE_ENV` | no | — | `production` switches log format + Docker default |
| `LOG_LEVEL` | no | `info`(prod)/`debug`(dev) | winston level |

## Known gaps (don't assume these are solved)

- No test suite (`bun test` script is a placeholder that exits 1).
- No lint script/config in `package.json`.

---

***Created by CodingCat, happy coding!***
