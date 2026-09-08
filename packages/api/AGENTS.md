# AGENTS.md

Guide for AI coding agents (Claude Code, Cursor, Copilot, Aider, ...) working in this repo. This is an Elysia + MikroORM + BullMQ template — several patterns here are load-bearing, not stylistic. Breaking them compiles fine and fails at runtime under concurrency, so read this before adding or changing code.

Read `README.md` first for the architecture overview. This file is the "don't break it" checklist.

## Non-negotiable invariants

### 1. Never touch the global `EntityManager` directly

`db.ts`'s `initORM()` returns one process-wide `{ orm, em }`. That `em` is **never** used to read/write data in request or job code — it exists only so `setup.ts` (`orm.em.fork()`) and job processors (`orm.em.fork()`) can derive per-unit-of-work forks from it.

- HTTP requests get their fork from `middlewares/setup.ts`'s `.derive()`.
- BullMQ jobs get their fork inline in the module's `worker.ts` (one `orm.em.fork()` per job — see `modules/user/worker.ts`).

If you're writing a query and typed `orm.em` instead of `em` (or a service built from it), stop — that's the bug this template was hardened against. `grep -rn "orm.em" src` matches `db.ts`, `setup.ts`, the `orm.em.fork()` line inside each module's `worker.ts`, and two `RequestContext.create(orm.em, ...)` call sites (`index.ts`'s `.mount()`, `macros/auth.ts`'s `checkAuth`) — both are the same fork-per-unit-of-work discipline applied to `better-auth-mikro-orm`, which does not fork the `EntityManager` on its own (see §10). Any other match is the bug.

### 2. Services are per-unit-of-work, never singletons

A service instance is constructed fresh inside `setup.ts`'s `.derive()` (for HTTP) for every single request, holding that request's `em`. Do **not**:

- Instantiate a service once at module load time and import the instance.
- Cache a service instance across requests/jobs.
- Give a service a longer lifetime than the `em` it holds.

Adding a new service = add a class taking `em` (and any other already-constructed services) via constructor, then add one line to `setup.ts`'s `.derive()` return object.

### 3. New controllers must `.use(setup)` (and `.use(authMacro)` if auth is needed) themselves

Elysia dedupes plugins by `name` (`setup` has `{ name: 'setup' }`), so calling `.use(setup)` in both `index.ts` and a controller is cheap and safe at runtime — it does not double-fork the `em`. But TypeScript resolves each file's context from its own composition chain, not its parent's. Skip `.use(setup)` in a new controller and `em`-equivalents won't type-check inside it, even though it'd work at runtime because `index.ts` already composed it globally. Copy the pattern in `modules/profile/index.ts`. (`.use(setup)` currently yields only `em` — there is no service registered in `setup.ts`'s `.derive()` yet; add one there when the first feature module needs it.)

### 4. One Queue per domain module, dispatch by job name

Don't create a new BullMQ `Queue` per job type. Follow `modules/user/queue.ts`: one queue per module, job payload is a discriminated union keyed by `type`/`name`, and the module's `worker.ts` dispatches via `switch (job.name)`. Register every new module's `Worker` in the top-level `src/worker.ts` (a **separate process** — `bun worker`/`bun worker:dev` — never import/start a `Worker` from `index.ts` or any HTTP-path code).

Enqueue jobs only **after** the DB write that triggered them has committed (see `auth.ts`'s `databaseHooks.user.create.after` — Better Auth calls it only once the new user row is committed, and the hook enqueues from inside that callback). Enqueuing first risks a job referencing a row that got rolled back.

### 5. Two Redis connections, never merge them

- `utils/redis.ts` (`getRedis()`) — shared singleton for `RedisCacheAdapter`. Retry-limited (`maxRetriesPerRequest: 3`) so a command fails fast during an outage instead of hanging.
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

### 9. Bull Board is Basic-Auth gated, not the Better Auth session — keep it that way

`/bull-board` uses `utils/basic-auth.ts` (constant-time `timingSafeEqual` compare) deliberately, because it's a browser-native dashboard without access to the app's session cookie. `index.ts` fails boot fast if `ENABLE_BULL_BOARD=true` without credentials set — preserve that fail-fast check if you touch boot-time env validation.

### 10. No application code reads or writes an auth cookie

Better Auth's mounted handler (`auth.handler`, wired in `index.ts`'s `.mount()`) issues and clears the `better-auth.session_token` cookie entirely on its own. The only session _read_ anywhere in this codebase is `auth.api.getSession({ headers })` inside `macros/auth.ts`, which hands Better Auth the real request headers and never touches `cookie` itself. If you find yourself reaching for Elysia's `cookie` context to set, read, or clear anything auth-related, stop — the design has been misunderstood; route it through `auth.ts` / the mounted handler instead.

One narrow, necessary exception to the broader "never touch the global `EntityManager`" rule above: `better-auth-mikro-orm@0.5.0` calls `orm.em.*` directly and does not fork the `EntityManager` itself. Both the `.mount()` call in `index.ts` and `checkAuth`'s `auth.api.getSession()` call in `macros/auth.ts` wrap their Better Auth calls in MikroORM's `RequestContext.create(orm.em, () => ...)` to work around this — that AsyncLocalStorage-based fork is what invariant #1 is actually enforcing there, just via a different mechanism than `setup.ts`'s `em.fork()`. Don't remove it as if it were a stray `orm.em` violation.

### 11. `export type App` (`index.ts`) is a public contract for `apps/client`

`apps/client` imports this type via `import type { App } from 'api'` and drives its Eden Treaty client off it (`apps/client/src/lib/eden-client.ts`) — that's the frontend's _only_ type-safety net against the API's actual routes/schemas. Consequences:

- Don't remove or rename the `App` export, and don't change `main`'s return shape in a way that breaks it.
- A route path change, a `model.ts` body/response schema change, or a new/removed route is effectively an API contract change — treat it with the same care as changing a public function signature.
- The frontend only sees the _built_ declaration (`dist/index.d.ts`, from `bun run build` / `tsc --emitDeclarationOnly`) — Turborepo's `dev` task has no `dependsOn: build`, so nothing rebuilds it automatically. After changing routes/schemas here, rebuild this package (or run `bunx turbo build --filter=api`) so `apps/client` isn't type-checking against a stale contract.

## Adding a new feature module (checklist)

Mirror `src/modules/profile/` — the reference module post-migration. It has no `service.ts` (its two routes only echo `checkAuth`'s resolved `user`, no DB access of their own); add one only once the module actually needs a query:

1. `modules/<name>/model.ts` — typebox request/response schemas.
2. `modules/<name>/service.ts` — plain class, `em` (and any dependency services) via constructor, throws `HttpError` subclasses. Skip this file if the module has nothing to query/mutate yet.
3. `modules/<name>/index.ts` — Elysia controller: `.use(setup)`, `.use(authMacro)` if it needs auth, routes with `body`/`response` schemas from `model.ts`.
4. If you added a service, register it in `middlewares/setup.ts`'s `.derive()`.
5. Mount the controller in `index.ts`'s `/api` group.
6. Only if the feature needs background work: `modules/<name>/queue.ts` (one `Queue`, discriminated job union) + `modules/<name>/worker.ts` (processor, `switch (job.name)`), then register the `Worker` in `src/worker.ts` — see `modules/user/queue.ts` + `worker.ts`, which stayed in place across the auth migration purely for their BullMQ job (`send-welcome-email`), not for any HTTP routes.

## Testing

`bun test`, co-located `*.test.ts` next to the source they cover. Two layers — see `README.md`'s "Testing" section for the full explanation:

- Pure unit tests (`utils/*.test.ts`, `middlewares/errorMiddleware.test.ts`) — no external services.
- Route-level tests (`modules/profile/profile.test.ts`) — `app.handle(new Request(...))` against **real** Postgres + Redis, no mocks. `main` is `export`ed from `index.ts` specifically so tests can call it and get a live `Elysia` instance; its bottom-of-file self-invocation is guarded by `if (require.main === module)` so importing it for a test never double-boots the real server. `beforeEach` truncates the auth tables — write new route tests the same way, don't leave rows behind for the next test/run.

There is still no CI (`.github/workflows` doesn't exist) — these tests only run when someone runs them locally. If you wire up CI, don't silently skip these; either run them for real (needs a Postgres+Redis service in the CI job) or say explicitly they're excluded and why.

Run via `bun run test` (root or here), not a bare `bun test` from the repo root — the latter loads env relative to the root CWD, where there's no `.env` (only `packages/api/.env`), so the route-level tests fail immediately on the boot-time env check, before Postgres/Redis reachability is even relevant.

## Before you finish

- Run `bun run check-types` (`bunx tsc --noEmit`), `bun run lint` (oxlint), and from the repo root: `bun run format:check` (Prettier). Zero errors **and** zero warnings before shipping — see root `AGENTS.md`'s "Before shipping" for the fix-vs-suppress rule.
  - Linting is Turborepo-orchestrated and can be run locally here.
  - Formatting is always done from the repo root with `bun run format` / `bun run format:check` (not via Turborepo).
- Run `bun test` (needs Postgres + Redis reachable — see "Testing" above) if you touched anything under `modules/profile/`, `macros/auth.ts`, `auth.ts`, or `middlewares/`.
- Don't add a new `.env` var without adding it to `.env.example` with a comment on when it's required.
