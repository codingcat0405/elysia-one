# AGENTS.md

Guide for AI coding agents (Claude Code, Cursor, Copilot, Aider, ...) and human contributors working in this repo. Read this first for the monorepo-level contract between `apps/client` and `packages/api`; each package has its own `AGENTS.md` for its internal invariants — read that too before touching code inside it.

- Backend rules: [`packages/api/AGENTS.md`](./packages/api/AGENTS.md)
- Frontend rules: [`apps/client/AGENTS.md`](./apps/client/AGENTS.md)

## Layout

Bun workspaces + Turborepo. Two packages:

- `packages/api` — Elysia + MikroORM (PostgreSQL) + BullMQ (Redis) backend. Owns the database, auth (JWT issuing/verification), and background jobs.
- `apps/client` — TanStack Start + React frontend. Owns nothing durable; it's a typed client over `packages/api`.

## The FE/BE contract: Eden Treaty, not a hand-written API client

`packages/api/src/index.ts` exports `export type App = Awaited<ReturnType<typeof main>>`. `apps/client` imports it (`import type { App } from 'api'`, a workspace dependency) and builds its entire API surface from it via `@elysia/eden`'s `treaty<App>(...)` in `apps/client/src/lib/eden-client.ts`. This is the **only** sanctioned way the frontend talks to the backend.

Non-negotiable consequences:

1. **Never hand-write a `fetch`/`axios` call to the API from `apps/client`.** Every request goes through `api.<path>.<method>()` from `lib/eden-client.ts`, wrapped in that file's `unwrap()` helper (Eden never throws on non-2xx; `unwrap` turns `{ data, error }` into throw-or-return so callers can use plain `try/catch`).
2. **The frontend's types come from a build artifact, not live source.** `packages/api/package.json`'s `"types"` field points at `dist/index.d.ts`, produced by `bun run build` (`tsc --emitDeclarationOnly`) in `packages/api`. `dist/` is gitignored, and Turborepo's `dev` task has **no** `dependsOn: build` — nothing rebuilds it for you. After changing a route path, adding/removing a route, or changing a `model.ts` body/response schema in `packages/api`, run `bun run build` there (or `bunx turbo build --filter=api`) before trusting `apps/client`'s types or before it will pick up the change at all.
3. **Treat `packages/api` routes/schemas as a public API contract from the frontend's perspective.** A schema change isn't just a backend refactor — it can silently break `apps/client`'s type-checking (stale `dist/` = stale types, not a compile error) or its runtime behavior (missing field, renamed field). When you change a route in `packages/api`, check `apps/client` for callers of that route in the same change.
4. **Don't duplicate the API contract by hand** — no manually-written request/response TypeScript interfaces in `apps/client` for data that Eden Treaty already types from `App`. If Eden's inferred type is awkward for a specific case, fix the backend's `model.ts` schema rather than working around it with a local hand-rolled type.

## Auth model (spans both packages)

- `packages/api` issues two stateless JWTs on login/register (`jsonwebtoken`, `JWT_SECRET`/`JWT_REFRESH_SECRET`, separate secrets so an access token can never be replayed as a refresh token): an access token (`15m` lifetime, read from the `access_token` httpOnly cookie), and a refresh token (`30d` lifetime, read from the `refresh_token` httpOnly cookie). Verification happens per-request via the `checkAuth` macro (`packages/api/src/macros/auth.ts`). Refresh-token rotation is stateless (no database token table) — every call to `POST /api/users/refresh` re-reads the user row from the database as the only revocation lever. `POST /api/users/logout` clears both cookies server-side. See `packages/api/AGENTS.md` for backend-side rules.
- `apps/client` never reads the tokens (they're httpOnly, invisible to JavaScript). Auth state is derived by calling `GET /users/me` via `unwrapAuthed()` in `eden-client.ts`, never read from client-side storage. A Zustand store (`apps/client/src/stores/user-store.ts`) mirrors "who's logged in". See `apps/client/AGENTS.md` for frontend-side rules.
- **Important: SameSite=Strict limitation.** Cookies use `SameSite=Strict` for CSRF mitigation, which requires client and API to share a registrable domain. A genuinely cross-site deployment (API on `api.example.com`, client on `app.different-site.com`) doesn't work — cookies are never sent cross-site even with explicit credentials. If that's your use case, switch to `SameSite=None` + a real CSRF token scheme (out of scope; currently not implemented).
- Don't introduce a second auth mechanism (e.g. JWT bearer header alongside cookies, or OAuth without updating both sides) without updating both packages deliberately — they are not designed to coexist.

## No in-process horizontal scaling — that's the deployment platform's job

`packages/api` does **not** implement `node:cluster`/worker-thread scaling. This was considered and rejected: deployments target Kubernetes (or similar), where replica count already provides horizontal scaling, and Bun's multi-instance-per-port mode doesn't reliably kill forked workers on local dev-server stop/hot-reload. Don't reintroduce in-process clustering (e.g. a `WORKER_THREADS` env var) without re-solving both problems — see `packages/api/README.md` → "Why no `node:cluster` / worker-threads scaling".

## Commands

```sh
bun install                        # once, from repo root
bun run dev                        # turbo: runs client + api dev servers
bun run build                      # turbo: builds every workspace (needed for api's dist/index.d.ts)
bun run check-types                # turbo: tsc --noEmit across every workspace
bunx turbo dev --filter=client     # single workspace
bunx turbo build --filter=api      # single workspace — run after backend route/schema changes
```

## Env files

- `packages/api/.env` (from `.env.example`) — `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `REDIS_URL` are required at boot (fails fast if missing, or if the two JWT secrets are equal). `CLIENT_URL` is not boot-required — it defaults to `http://localhost:3001` — but must be set correctly for credentialed CORS to work outside that default. See `packages/api/README.md` for the full table.
- `apps/client/.env` (from `.env.example`) — `VITE_API_URL`, defaults to `http://localhost:3000`.

Never commit `.env` files. Adding a new required var to either package: update its `.env.example` with a comment explaining when it's required.
