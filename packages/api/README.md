# Elysia Forge - Elysia + MikroORM + BullMQ template

Production-hardened Bun backend: Elysia (HTTP), MikroORM/PostgreSQL (data), BullMQ/Redis (background jobs), Winston (logging), [Better Auth](https://better-auth.com) (username/password + Google OAuth, httpOnly session cookie) on a `better-auth-mikro-orm` adapter over the same MikroORM pool. Exports an `App` type consumed by `apps/client` via Eden Treaty for end-to-end type safety — see "Eden Treaty type export" below.

Horizontal scaling is handled by the deployment platform (multiple stateless replicas, e.g. Kubernetes), not by in-process clustering — this template deliberately does not implement `node:cluster`/worker-thread scaling. See "Pool sizing" below.

## Quick start

```bash
cp .env.example .env   # fill BETTER_AUTH_SECRET (openssl rand -base64 48), DATABASE_URL, REDIS_URL
bun install
bun dev                 # watch mode; schema auto-sync on boot (see "Schema" below)
```

Google sign-in is optional — see `.env.example`'s `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` comments for the Google Cloud Console step. Skip it to run with username/password only; the API boots fine with neither var set.

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
  index.ts                    # boot: env checks, schema sync, composes + starts the Elysia app
                               # (mounts Better Auth's handler), graceful shutdown; exports `App`
                               # type for Eden Treaty (see below)
  worker.ts                   # separate process: BullMQ Worker(s), no HTTP server
  db.ts                       # cached initORM() — one MikroORM instance per process
  auth.ts                     # memoized initAuth(): Better Auth instance (username plugin,
                               # optional Google OAuth) over the mikroOrmAdapter
  mikro-orm.config.ts         # driver, pool, result-cache adapter config
  bull-board.ts               # /bull-board dashboard plugin, Basic-Auth gated

  middlewares/
    setup.ts                  # per-request: em.fork() + service instances (the core pattern)
    responseMiddleware.ts     # auto-serializes MikroORM entities, strips `hidden` props
    errorMiddleware.ts        # maps HttpError / validation / 404 -> JSON, else generic 500

  macros/
    auth.ts                   # `checkAuth(roles)` macro: resolves the Better Auth session via
                               # `auth.api.getSession({ headers })`, injects `user`

  modules/
    profile/
      index.ts                # Elysia controller: GET /api/profile/{me,admin}, role-gated demo
      model.ts                # typebox request/response schemas
    user/
      queue.ts                # BullMQ Queue for this module's jobs (send-welcome-email)
      worker.ts                # job processor(s) for this module's queue

  entities/                   # shared MikroORM entities: BaseEntity, AuthBaseEntity,
                               # AuthUser, AuthSession, AuthAccount, AuthVerification

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
2. **Never use the global `orm.em` in modules** — only the derived `em` / services. Grep for `orm.em` outside `db.ts`, `setup.ts`, job processors, and the two `RequestContext.create(orm.em, ...)` wrappers (`index.ts`'s `.mount()`, `macros/auth.ts`) that work around `better-auth-mikro-orm` not forking the `EntityManager` itself, in review.
3. **Services are per-request instances, not singletons** — an app-lifetime object must never hold a request-lifetime `em`.
4. Controllers `.use(setup)` (and `.use(authMacro)` if they need auth) themselves — Elysia dedupes the plugin by name at runtime, but each file is typechecked on its own composition chain, so the context types (`em`, `user`) only resolve if the file declares the `.use()` itself.

### Schema: auto-sync, no migrations (intentional)

`index.ts` runs `orm.schema.updateSchema()` unconditionally on every boot — dev **and** prod, single **and** cluster mode (once, in the primary, before forking workers). This is deliberate for this project: schema changes ship by changing entities, not by writing/running migration files. There is no `migrations` block in `mikro-orm.config.ts` and no `migration:*` scripts in `package.json` — don't add them unless explicitly asked; `@mikro-orm/cli` being present is incidental (transitive dep), not a signal to wire up migrations.

If you change an entity, `updateSchema()` picks it up on next boot — no extra step needed. Keep this in mind for destructive changes (renaming/dropping a column): auto-sync applies the diff directly, there's no migration file to review before it runs against a real database.

### Pool sizing

Per-process pool via `DB_POOL_MAX` (default 10). Each running instance of the API (each k8s pod replica, each `bun start` process) owns its own pool: `total connections = replicas × DB_POOL_MAX` — keep that under Postgres `max_connections` with headroom, or put pgBouncer in front. This template has no in-process horizontal scaling (see next section); replica count is a deployment-time concern, not something set via an env var here.

### Why no `node:cluster` / worker-threads scaling

Considered and deliberately rejected for this template:

1. Deployments run on Kubernetes (or similar), which already handles horizontal scaling via replica count — an in-process cluster would just duplicate that at a different layer.
2. Bun's multi-instance-on-one-port mode doesn't reliably tear down forked workers on dev-server stop/hot-reload, leaking background processes during local development.

If you truly need in-process multi-core usage outside k8s, evaluate it as a deliberate, separate change — don't casually re-add a `WORKER_THREADS` env var without re-solving both problems above.

### Eden Treaty type export (end-to-end type safety)

`src/index.ts` exports `export type App = Awaited<ReturnType<typeof main>>` — the full Elysia app type, routes and typebox schemas included. `apps/client` imports it as `import type { App } from 'api'` (workspace dependency) and passes it to `treaty<App>(...)` (`@elysia/eden`) in `apps/client/src/lib/eden-client.ts`, giving the frontend compile-time-checked routes, request bodies, and response shapes with zero manual typing.

This only works if `packages/api`'s declaration output is built: `bun run build` (`tsc --emitDeclarationOnly`) writes `dist/index.d.ts`, which is what `package.json`'s `"types"` field points resolvers at. `dist/` is gitignored and **not** rebuilt automatically by `bun run dev` (Turborepo's `dev` task has no `dependsOn: build`). Practically:

- After cloning, run `bun run build` in `packages/api` (or `bunx turbo build --filter=api`) once before relying on `apps/client`'s eden types.
- Whenever you add/rename a route, or change a `model.ts` body/response schema, rebuild `packages/api` so `apps/client`'s types stay in sync — otherwise the client either type-checks against a stale contract or silently keeps working with outdated IDE hints until the next build.

### Background jobs (BullMQ)

- One **Queue per domain module** (e.g. `modules/user/queue.ts`), not one queue per job type — job data is a discriminated union (`{ type: '...' }`), dispatched via `switch (job.name)` in the module's `worker.ts`.
- Register every module's `Worker` in the top-level `src/worker.ts` — that's a **separate process** (`bun worker`/`bun worker:dev`), never started inside the HTTP server process.
- `utils/bull-connection.ts` is a **dedicated** ioredis connection (`maxRetriesPerRequest: null`, required by BullMQ's blocking commands). Never reuse the shared `utils/redis.ts` client for BullMQ, and vice versa.
- Enqueue jobs **after** the triggering DB write succeeds — never enqueue for a row that might still roll back (see `auth.ts`'s `databaseHooks.user.create.after`, which Better Auth fires only once the new user row is committed).

### Bull Board dashboard

Mounted at `/bull-board`, gated by HTTP Basic Auth (`utils/basic-auth.ts`, constant-time compare) — deliberately not the app's Better Auth session cookie, since this is a browser-native dashboard without direct access to the httpOnly session cookie. Boot fails fast (`index.ts`) if `ENABLE_BULL_BOARD=true` but `BULL_BOARD_USER`/`BULL_BOARD_PASSWORD` aren't set. Exposes internal job payloads — never expose this publicly without auth.

### Redis: two separate clients, on purpose

| Client | File | Used by | Notes |
|---|---|---|---|
| Shared client | `utils/redis.ts` (`getRedis()`) | `RedisCacheAdapter`, `RedisLock` | Singleton, retry-limited, safe for normal commands |
| Dedicated client | `utils/bull-connection.ts` | BullMQ `Queue`/`Worker` | `maxRetriesPerRequest: null`, required for blocking ops |

`mikro-orm.config.ts` still falls back to `MemoryCacheAdapter` (per-process, not shared) when `REDIS_URL` is unset, but `index.ts`'s boot-time required-env check means normal `bun dev`/`bun start` never reaches that path — `REDIS_URL` is mandatory. The fallback only matters for code paths that import `db.ts` without going through `index.ts`'s checks (e.g. a future test harness).

### Error handling

Services/macros throw `HttpError` subclasses (`utils/http-errors.ts`): `BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`. `errorMiddleware` maps these to their status + message; Elysia `VALIDATION`/`NOT_FOUND` codes are special-cased; anything else is logged server-side and returns a generic 500 (never leaks internal error text to clients).

### Response serialization

`responseMiddleware` auto-converts MikroORM entities (single or array) returned from handlers into plain objects via `wrap(entity).toObject()`, which also strips any `@Property({ hidden: true })` field. Return entities directly from handlers — don't hand-roll serialization, and don't skip the `response` typebox schema on routes (it's the second guarantee against leaking fields, independent of `hidden`).

**Exception: the four `Auth*` entities never use `hidden: true`.** `AuthAccount.password`/`accessToken`/`refreshToken`/`idToken` are genuinely sensitive but are **not** marked `hidden` — `better-auth-mikro-orm`'s adapter reads use MikroORM's `serialize()` internally too, which would silently drop those fields on Better Auth's own credential-verification and OAuth-refresh reads, breaking login (confirmed empirically, see `entities/AuthAccount.ts`'s comment). The actual defense is structural: no route in `modules/*` returns an `AuthUser`/`AuthAccount`/`AuthSession`/`AuthVerification` entity — `modules/profile` builds a plain `{ id, username, role }` object from `checkAuth`'s resolved session instead. If you ever add a route that returns one of these entities directly, you've reopened this hole; return a hand-picked plain object instead.

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP port |
| `DATABASE_URL` | **yes** | — | Postgres connection string |
| `BETTER_AUTH_SECRET` | **yes** | — | Signs/verifies session tokens and CSRF state; boot fails fast if missing. 32+ chars, `openssl rand -base64 48` |
| `BETTER_AUTH_URL` | no | `http://localhost:${PORT}` | Public origin of this API; used to construct the OAuth callback URL. Must be the exact public URL in prod |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no, but paired | — | Google sign-in is enabled only when **both** are set; boot fails fast if exactly one is set. See "Quick start" above for the Google Cloud Console step |
| `CLIENT_URL` | no | `http://localhost:3001` | Exact browser origin(s) for credentialed CORS, comma-separated for multiple. Also doubles as Better Auth's `trustedOrigins` (Origin/Referer check on state-changing requests). Not boot-required (defaults to the dev port), but a wrong value silently breaks cookie storage in the browser — no boot-time check catches it |
| `DB_POOL_MIN` / `DB_POOL_MAX` | no | `0` / `10` | Per-process pool; multiply by replica count when sizing Postgres `max_connections` |
| `DB_POOL_ACQUIRE_TIMEOUT_MS` | no | `10000` | Fail fast instead of hanging |
| `DB_POOL_IDLE_TIMEOUT_MS` | no | `30000` | Keep under infra idle timeouts |
| `ENABLE_SWAGGER` | no | auto outside prod | Set `true` to force-enable in prod |
| `REDIS_URL` | **yes** | — | Boot fails fast if missing (also required for the worker, `bun worker`) |
| `WORKER_CONCURRENCY` | no | `5` | Jobs processed in parallel, per worker process |
| `ENABLE_BULL_BOARD` | no | `false` | If `true`, `BULL_BOARD_USER`/`PASSWORD` become required |
| `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD` | conditionally | — | HTTP Basic Auth for `/bull-board` |
| `NODE_ENV` | no | — | `production` switches log format + Docker default; also enables `Secure` flag on the session cookie |
| `LOG_LEVEL` | no | `info`(prod)/`debug`(dev) | winston level |

## Deploying with cookie auth

The httpOnly session cookie imposes a few deployment constraints:

1. **CLIENT_URL must be the exact browser origin.** It is both the CORS origin and Better Auth's `trustedOrigins` entry. Credentialed cookies silently fail to store if the browser origin doesn't match exactly, and `trustedOrigins` rejects state-changing requests from anything not on the list. `CLIENT_URL=https://app.example.com` works; a wildcard does not — and it is **not** boot-required, it silently defaults to `http://localhost:3001`, so double-check it explicitly in every environment.

2. **BETTER_AUTH_URL must be the exact public URL of this API in production.** It's used to construct the Google OAuth callback URL (`${BETTER_AUTH_URL}/api/auth/callback/google`) — the production Google redirect URI must be registered separately from the dev one in the Google Cloud Console.

3. **SameSite=Lax, not Strict.** The session cookie uses Better Auth's default `SameSite=Lax` — required so the Google OAuth redirect survives (Strict cookies don't survive a top-level cross-site navigation back from `accounts.google.com`). CSRF defence is Lax's own same-site-for-unsafe-methods behaviour plus the `trustedOrigins` check above, not `SameSite=Strict`.

4. **NODE_ENV=production enables the Secure flag.** In production, the session cookie is marked `Secure`, so it's only sent over HTTPS. Locally, without `NODE_ENV=production`, it's sent over HTTP for easier testing. If your deployment doesn't set `NODE_ENV=production`, the cookie won't be sent to HTTPS clients (or vice versa).

There is no `COOKIE_DOMAIN`-equivalent var wired up — this template assumes client and API share an exact origin/registrable domain per environment. A genuinely split-subdomain deployment (client on `app.example.com`, API on `api.example.com`) would need `advanced.crossSubDomainCookies` configured in `src/auth.ts`; not done here, deliberately (see "Known gaps").

## Known gaps (don't assume these are solved)

- No test suite (`bun test` script is a placeholder that exits 1).
- No lint script/config in `package.json`.
- No rate limiting on `/api/auth/*` (sign-in/sign-up/etc. are unthrottled).
- No email verification (`user.emailVerified` is always `false`) and no password reset flow — the `verification` table exists (Better Auth core schema) but nothing writes to it; wiring either up means adding a mailer.
- No `advanced.crossSubDomainCookies` support — see "Deploying with cookie auth" above.

---

***Created by CodingCat, happy coding!***
