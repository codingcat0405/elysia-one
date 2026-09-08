# AGENTS.md

Guide for AI coding agents (Claude Code, Cursor, Copilot, Aider, ...) and human contributors working in this repo. Read this first for the monorepo-level contract between `apps/client` and `packages/api`; each package has its own `AGENTS.md` for its internal invariants — read that too before touching code inside it.

- Backend rules: [`packages/api/AGENTS.md`](./packages/api/AGENTS.md)
- Frontend rules: [`apps/client/AGENTS.md`](./apps/client/AGENTS.md)

## Layout

Bun workspaces + Turborepo. Two packages:

- `packages/api` — Elysia + MikroORM (PostgreSQL) + BullMQ (Redis) backend. Owns the database, auth (Better Auth: username/password + Google OAuth, session cookie), and background jobs.
- `apps/client` — TanStack Start + React frontend. Owns nothing durable; it's a typed client over `packages/api`.

## The FE/BE contract: Eden Treaty, not a hand-written API client

`packages/api/src/index.ts` exports `export type App = Awaited<ReturnType<typeof main>>`. `apps/client` imports it (`import type { App } from 'api'`, a workspace dependency) and builds its entire API surface from it via `@elysia/eden`'s `treaty<App>(...)` in `apps/client/src/lib/eden-client.ts`. This is the **only** sanctioned way the frontend talks to the backend.

Non-negotiable consequences:

1. **Never hand-write a `fetch`/`axios` call to the API from `apps/client`.** Every request goes through `api.<path>.<method>()` from `lib/eden-client.ts`, wrapped in that file's `unwrap()` helper (Eden never throws on non-2xx; `unwrap` turns `{ data, error }` into throw-or-return so callers can use plain `try/catch`).
2. **The frontend's types come from a build artifact, not live source.** `packages/api/package.json`'s `"types"` field points at `dist/index.d.ts`, produced by `bun run build` (`tsc --emitDeclarationOnly`) in `packages/api`. `dist/` is gitignored, and Turborepo's `dev` task has **no** `dependsOn: build` — nothing rebuilds it for you. After changing a route path, adding/removing a route, or changing a `model.ts` body/response schema in `packages/api`, run `bun run build` there (or `bunx turbo build --filter=api`) before trusting `apps/client`'s types or before it will pick up the change at all.
3. **Treat `packages/api` routes/schemas as a public API contract from the frontend's perspective.** A schema change isn't just a backend refactor — it can silently break `apps/client`'s type-checking (stale `dist/` = stale types, not a compile error) or its runtime behavior (missing field, renamed field). When you change a route in `packages/api`, check `apps/client` for callers of that route in the same change.
4. **Don't duplicate the API contract by hand** — no manually-written request/response TypeScript interfaces in `apps/client` for data that Eden Treaty already types from `App`. If Eden's inferred type is awkward for a specific case, fix the backend's `model.ts` schema rather than working around it with a local hand-rolled type.
5. **Scoped exception — auth flows use Better Auth's own client, not Eden Treaty.** `apps/client/src/lib/auth-client.ts` is the _only_ sanctioned non-Eden path to the API, and it may only be used for authentication: sign-up, sign-in (username/password and Google), sign-out, and session lookup. Better Auth serves `/api/auth/*` from a mounted handler that Elysia never types, so those endpoints cannot appear in `App` and Eden cannot reach them; OAuth in particular is a browser redirect, not a typed JSON call. Everything that is not authentication — including `/api/profile/*` — still goes through `api.<path>.<method>()` in `eden-client.ts`. Do not add a third client, and do not route non-auth calls through `authClient`.

## Auth model (spans both packages)

- `packages/api` owns `/api/auth/*` via [Better Auth](https://better-auth.com), mounted on a `better-auth-mikro-orm` adapter over the same MikroORM pool `packages/api` already uses for everything else — no second database connection. Two sign-in methods: username+password and Google OAuth. The session is an httpOnly `better-auth.session_token` cookie at `SameSite=Lax`. Server-side authorization is `checkAuth(roles)` in `packages/api/src/macros/auth.ts`, which calls `auth.api.getSession({ headers })` per request — no JWT verification anywhere. `role` is a server-owned Better Auth `user.additionalFields` entry (`input: false`): it is never settable from client input on sign-up/sign-in, nor from a Google OAuth profile. See `packages/api/AGENTS.md` for backend-side rules.
- `apps/client` never reads the session cookie (httpOnly, invisible to JavaScript). Auth state is derived via `apps/client/src/lib/auth-client.ts`'s `getSessionUser()` (wraps Better Auth's `authClient.getSession()`), never read from client-side storage. A Zustand store (`apps/client/src/stores/user-store.ts`) mirrors "who's logged in". See `apps/client/AGENTS.md` for frontend-side rules.
- **`SameSite=Lax` is required, not `Strict`** — the Google OAuth redirect back from `accounts.google.com` is a top-level cross-site navigation, which `SameSite=Strict` cookies do not survive. CSRF defence is therefore Lax's own same-site-for-unsafe-methods behaviour plus Better Auth's `trustedOrigins` check (an explicit Origin/Referer allowlist on state-changing requests) — so `CLIENT_URL` (which feeds `trustedOrigins`) must be the exact production origin, not a wildcard.
- Don't introduce a second auth mechanism (e.g. a JWT bearer header alongside the session cookie, or a hand-rolled OAuth flow) without updating both packages deliberately — they are not designed to coexist.

## Commands

```sh
bun install                        # once, from repo root
bun run dev                        # turbo: runs client + api dev servers
bun run build                      # turbo: builds every workspace (needed for api's dist/index.d.ts)
bun run check-types                # turbo: tsc --noEmit across every workspace
bun run lint                       # turbo: oxlint across every workspace
bun run format                     # prettier: format all files (root-only, not via turbo)
bun run format:check               # prettier: check formatting without writing (root-only, not via turbo)
bunx turbo dev --filter=client     # single workspace
bunx turbo build --filter=api      # single workspace — run after backend route/schema changes
```

## Env files

- `packages/api/.env` (from `.env.example`) — `DATABASE_URL`, `BETTER_AUTH_SECRET`, `REDIS_URL` are required at boot (fails fast if missing). `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are optional but paired — boot fails fast if exactly one is set. `CLIENT_URL` is not boot-required — it defaults to `http://localhost:3001` — but must be set correctly for both credentialed CORS and Better Auth's `trustedOrigins` to work outside that default. See `packages/api/README.md` for the full table.
- `apps/client/.env` (from `.env.example`) — `VITE_API_URL`, defaults to `http://localhost:3000`. Also doubles as the Better Auth client's `baseURL` (`apps/client/src/lib/auth-client.ts`).

Never commit `.env` files. Adding a new required var to either package: update its `.env.example` with a comment explaining when it's required.
