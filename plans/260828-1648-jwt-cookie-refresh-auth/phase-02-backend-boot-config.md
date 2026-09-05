# Phase 02 — Backend boot config (env validation, credentialed CORS, swagger)

## Context links

- Research: [`researcher-260828-1635-elysia-cookie-jwt-refresh-report.md`](../reports/researcher-260828-1635-elysia-cookie-jwt-refresh-report.md) §2 (credentialed CORS)
- Invariants: `packages/api/AGENTS.md` §10 (preserve fail-fast boot checks), root `AGENTS.md` §Env files

## Overview

- **Priority:** P1 · **Status:** pending · **Effort:** 1h · **Blocks on:** Phase 01
- Make the new env vars required/documented, switch CORS to an explicit credentialed origin, update the swagger security scheme.

## Key insights

- `packages/api/src/index.ts:12-16` already has the fail-fast loop `for (const key of ["JWT_SECRET", "DATABASE_URL", "REDIS_URL"])`. Extend it — do not add a second, parallel check.
- `packages/api/src/index.ts:36` calls `cors()` with **no config**, which defaults to reflecting the request origin without `Access-Control-Allow-Credentials`. With `credentials: true` the origin can no longer be `true`/`*` (report §2) — the browser will reject every credentialed response otherwise, and the symptom is a silent "cookie never stored", not a visible error.
- `index.ts:57-63` declares `securitySchemes.JwtAuth` as `http`/`bearer`. That is now a lie; the routes at `modules/user/index.ts:37,45` reference it via `detail.security`.

## Requirements

1. Boot fails fast when `JWT_REFRESH_SECRET` is missing.
2. CORS allows exactly the configured client origin(s) with `credentials: true`.
3. `.env.example` documents every new var with the "when is it required" comment the root `AGENTS.md` mandates.
4. Swagger describes cookie auth, not bearer auth.

## Related code files

**Modify**
- `packages/api/src/index.ts` — env loop (line 12), `cors()` (line 36), swagger `securitySchemes` (lines 55-65).
- `packages/api/.env.example` — `JWT_EXPIRES_IN` default, new vars.

## Implementation steps

1. Env loop → `["JWT_SECRET", "JWT_REFRESH_SECRET", "DATABASE_URL", "REDIS_URL"]`.
2. Add a second fail-fast check right after it: if `JWT_REFRESH_SECRET === JWT_SECRET`, throw. Identical secrets silently reintroduce the exact token-type-confusion the two-secret design exists to prevent, and nothing else in the system would ever notice.
3. CORS:
   ```
   const clientOrigins = (process.env.CLIENT_URL ?? 'http://localhost:3001').split(',').map(s => s.trim())
   .use(cors({ origin: clientOrigins, credentials: true }))
   ```
   `3001` is the real dev port (`apps/client/package.json:9` → `vite dev --port 3001`). Read `process.env` here at composition time inside `main()`, not at module scope.
4. Swagger security scheme → `JwtAuth: { type: 'apiKey', in: 'cookie', name: 'access_token', description: 'httpOnly access_token cookie, set by POST /api/users/login' }`. Drop `swaggerOptions.persistAuthorization` if it no longer applies — Swagger UI cannot set a cookie from JS, but it is served same-origin with the API, so calling `/api/users/login` from within Swagger UI stores the cookie in the browser and every subsequent "Try it out" carries it automatically. Note this in the scheme description.
5. `.env.example`:
   ```
   # generate with: openssl rand -base64 48
   JWT_SECRET=
   JWT_EXPIRES_IN=15m

   # Required — boot fails fast if missing, and must NOT equal JWT_SECRET.
   # Separate secret for the refresh token so an access token can never be
   # replayed at /api/users/refresh. generate with: openssl rand -base64 48
   JWT_REFRESH_SECRET=
   JWT_REFRESH_EXPIRES_IN=30d

   # Exact browser origin(s) of apps/client, comma-separated. Required for
   # credentialed CORS — a wildcard origin makes the browser discard the
   # auth cookies. Defaults to the vite dev port.
   CLIENT_URL=http://localhost:3001

   # Leave UNSET in local dev (localhost cookies are shared across ports).
   # In production set it to the shared parent domain when the client and the
   # API are on different subdomains, e.g. .example.com — otherwise the auth
   # cookie is host-only to the API and the client's SSR server never sees it.
   # COOKIE_DOMAIN=
   ```
6. `bunx turbo build --filter=api` — **mandatory gate before Phase 03.** `apps/client` types come from `packages/api/dist/index.d.ts`; nothing rebuilds it (root `AGENTS.md` §2). Skipping this makes the new `/refresh` and `/logout` routes invisible to Eden and makes `data.jwt` still appear to exist.

## Todo list

- [ ] `JWT_REFRESH_SECRET` in the boot env loop
- [ ] Boot rejects `JWT_REFRESH_SECRET === JWT_SECRET`
- [ ] `cors({ origin: clientOrigins, credentials: true })`
- [ ] Swagger scheme → `apiKey in cookie`
- [ ] `.env.example` updated (all 5 var changes) + local `.env` updated by hand
- [ ] `bunx turbo build --filter=api` succeeded

## Success criteria

- `bun dev` with `JWT_REFRESH_SECRET` unset → process exits with `Missing required env var: JWT_REFRESH_SECRET`.
- `bun dev` with the two secrets equal → process exits with a distinct message.
- Preflight check: `curl -i -X OPTIONS http://localhost:3000/api/users/login -H 'Origin: http://localhost:3001' -H 'Access-Control-Request-Method: POST'` returns `Access-Control-Allow-Origin: http://localhost:3001` (echoed exactly, not `*`) **and** `Access-Control-Allow-Credentials: true`.
- Same request with `Origin: http://evil.test` does **not** return an ACAO header.
- `packages/api/dist/index.d.ts` mtime is newer than `modules/user/model.ts`.

## Risk assessment

| Risk | L×I | Mitigation |
|------|-----|------------|
| `credentials: true` with a wildcard/reflected origin → browser silently drops every auth cookie; looks like "login does nothing" | M×H | Explicit `CLIENT_URL`; the two curl assertions above catch it before any FE work. |
| `CLIENT_URL` unset in prod → CORS falls back to `localhost:3001` and prod login breaks | M×H | Documented in `.env.example` as required-in-prod. Considered making it a hard boot requirement; rejected because it would break the zero-config local start this template advertises. Called out in the Phase 05 deployment note instead. |
| `COOKIE_DOMAIN` forgotten in prod with FE/API on different subdomains → SSR guard never sees the cookie, every page load redirects to `/login` | M×H | This is the single most likely production-only failure. `.env.example` comment + Phase 05 deployment checklist item. |
| Stale `dist/` → `apps/client` typechecks green against the old contract and fails at runtime | H×M | Explicit build gate (step 6) + the `dist/index.d.ts` mtime success criterion. |
| Swagger "Try it out" appears broken to a maintainer used to pasting a bearer token | M×L | Scheme `description` explains the login-first flow. |

## Security considerations

- **CSRF, accepted limitation.** `SameSite=Strict` is the only CSRF defence; there is no CSRF token scheme (out of scope for this template). Consequences that must be documented, not silently assumed away:
  - Strict is evaluated per *site* (registrable domain), not per origin. `localhost:3001` → `localhost:3000` is same-site, so dev works. `app.example.com` → `api.example.com` is same-site, so that production shape works.
  - A deployment that puts the client and the API on genuinely different sites (`app.example.com` + `api.somevendor.io`) **will not work at all** — the cookie is neither sent nor storable in a way SSR can read. Such a deployment must move to `SameSite=None; Secure` and add a real CSRF token scheme first.
  - Strict also means cookies are not sent on inbound cross-site top-level navigations (e.g. following an emailed link into the app), so the first render after such a navigation looks logged-out. Accepted for a template; `SameSite=Lax` would fix the navigation case at the cost of CSRF exposure on cross-site `GET`.
- `JWT_REFRESH_SECRET` has no `VITE_` prefix and is never referenced from `apps/client` — it must never reach the client bundle.

## Next steps

Phase 03 — frontend transport. Do not start it until `bunx turbo build --filter=api` has succeeded.
