---
title: "httpOnly-cookie access+refresh JWT auth (full replacement of localStorage bearer)"
description: "Replace localStorage single-JWT bearer auth with httpOnly cookie access+refresh token pair, stateless rotation, SSR-protected route guards."
status: implemented (live end-to-end verification skipped — see phase-05)
priority: P1
effort: 9h
branch: main
tags: [auth, security, api, frontend, breaking-change]
created: 2026-08-28
---

# httpOnly Cookie Access + Refresh JWT Auth

Full replacement of the auth transport across `packages/api` and `apps/client`. No DB table for tokens (stateless rotation).

## Called-out breaking / behaviour changes

| # | Change | Impact |
|---|--------|--------|
| B1 | **`UserModel.loginResponse` drops `jwt`** → becomes `{ user }`. Public API contract break (`export type App`). | Any consumer reading `data.jwt` breaks. Only consumer today: `apps/client` login/register. |
| B2 | `JWT_EXPIRES_IN` default `1d` → **`15m`**. Existing `.env` files with `JWT_EXPIRES_IN=1d` keep 1d access tokens — must be edited by hand. | Deployment action required. |
| B3 | Auth transport moves from `Authorization: Bearer` to `access_token` cookie. **Bearer header is no longer accepted at all.** | Any non-browser API client (curl, Postman, mobile) must be updated. |
| B4 | New **required** env var `JWT_REFRESH_SECRET` — boot fails fast if missing. | Deployment action required. |
| B5 | New env vars `CLIENT_URL` (CORS origin, required for credentialed CORS), `JWT_REFRESH_EXPIRES_IN` (default `30d`), `COOKIE_DOMAIN` (optional, required in prod when FE/API are on different subdomains). | Deployment action required. |
| B6 | `apps/client/src/lib/auth.ts` **deleted**. `getToken`/`setToken`/`clearToken` gone. | Violates current `apps/client/AGENTS.md` §2 — that rule is rewritten in Phase 05. |
| B7 | `_authed.tsx` / `login.tsx` / `register.tsx` drop `ssr: false` — auth now runs during SSR. | New server-side execution path; see F-04 risk (module-scope Zustand store). |
| B8 | Swagger `securitySchemes.JwtAuth` changes from `http/bearer` to `apiKey in cookie`. | Swagger "Try it out" now depends on logging in via Swagger's own origin. |

**Rebuild requirement:** after Phase 01+02, run `bunx turbo build --filter=api` before touching `apps/client` — Eden types come from `packages/api/dist/index.d.ts`, which nothing rebuilds automatically (root `AGENTS.md` §2, `packages/api/AGENTS.md` §11).

**No DB migration.** `entities/User.ts` and `entities/BaseEntity.ts` are untouched — refresh is stateless, no token table. Confirmed: nothing in Phase 01–05 changes an entity, so `orm.schema.updateSchema()` is a no-op diff.

## Phases

| # | Phase | Status | Blocks on | Effort |
|---|-------|--------|-----------|--------|
| 01 | [Backend auth core — cookie tokens, macro, refresh/logout routes](./phase-01-backend-auth-core.md) | done | — | 3h |
| 02 | [Backend boot config — env, CORS credentials, swagger](./phase-02-backend-boot-config.md) | done | 01 | 1h |
| 03 | [Frontend transport — eden-client cookies, SSR forwarding, refresh retry](./phase-03-frontend-eden-transport.md) | done | 02 (+`turbo build --filter=api`) | 3h |
| 04 | [Frontend SSR route guards](./phase-04-frontend-ssr-route-guards.md) | done | 03 | 1.5h |
| 05 | [Docs sync + end-to-end verification](./phase-05-docs-and-verification.md) | done (docs only — see note) | 04 | 1h |

## Key architectural decisions

- **Two secrets, two cookies.** `access_token` signed with `JWT_SECRET`, `refresh_token` with `JWT_REFRESH_SECRET`. Different secrets ⇒ an access token can never be replayed at `/refresh` and vice versa.
- **Services stay HTTP-agnostic.** `UserService` never touches `cookie`. Signing + cookie writes live in `utils/auth-tokens.ts` and the controller. Preserves `packages/api/AGENTS.md` §2 (per-unit-of-work services).
- **Cookie `maxAge` is derived from the JWT's own `exp` claim** (`jwt.decode(token).exp - now`), not re-parsed from `JWT_EXPIRES_IN`. Single source of truth; cookie and token can never drift.
- **`SameSite=Strict` + no CSRF token.** Documented limitation — see `phase-02` §Risk. Requires FE and API to share a registrable domain.
- **SSR performs the refresh, not just the client.** Without it, any hard page load >15m after login bounces to `/login` despite a valid 30-day refresh token — which would defeat refresh tokens entirely. See `phase-03` §Architecture.
- **No module-scope auth state on the server.** The Zustand store and any refresh-dedupe promise are process-global; writing request-derived data to them during SSR leaks across users. Guarded in Phase 03/04.

## Unresolved questions

See the end of `phase-03` and `phase-05`.

## Implementation notes (post-hoc)

- All 5 phases implemented. `bun run check-types`, `lint`, and `build` pass clean in both `packages/api` and `apps/client` (verified independently by a `code-reviewer` subagent, including a cache-bypassed `--force` rebuild).
- Code review surfaced 2 medium findings, both fixed: (1) `Header.tsx`'s `initialUser`-fallback could mask a real client-side logout/session-expiry behind a stale value until the next navigation — fixed with an explicit `hydrated` state flag instead of inferring hydration from `user.id === 0`; (2) `/refresh`'s catch-all didn't distinguish a DB blip from an actually-bad token in logs — added `logger.error` on the non-`UnauthorizedError` branch.
- Two library behaviors the plan flagged as needing empirical verification were instead resolved by reading the actual installed library source: `setResponseHeader('set-cookie', array)` does emit multiple `Set-Cookie` headers (confirmed against `@tanstack/react-start`'s `request-response.ts`), and Eden's per-call `headers` option merges with (does not replace) the global `headers()` config.
- **Live end-to-end verification (phase-05's 22-row matrix) was explicitly skipped at the user's direction** — no Redis running locally and no docker-compose/docker access available to start one. Everything shipped on static verification (types/lint/build + code review) only. Scenarios 5, 15, and 20 in particular (the ones the plan calls out as catching this design's unique failure modes) have never actually been run. Recommend running the matrix — or at minimum those three rows — before this is relied on anywhere beyond local dev.
- Minor doc-accuracy fix applied after the docs-manager pass: `CLIENT_URL` was documented as boot-required in `AGENTS.md` and `packages/api/README.md`; it is not (defaults to `http://localhost:3001`, only silently breaks CORS if wrong — no boot check catches it). Corrected in both files.
