# Phase 01 — Backend auth core (cookie tokens, macro, refresh/logout routes)

## Context links

- Research: [`plans/reports/researcher-260828-1635-elysia-cookie-jwt-refresh-report.md`](../reports/researcher-260828-1635-elysia-cookie-jwt-refresh-report.md) §1 (Elysia cookie API), §4 (double-token rotation)
- Invariants: `packages/api/AGENTS.md` §2 (per-request services), §6 (throw `HttpError`), §7 (declare response schemas), §11 (`App` is a public contract)

## Overview

- **Priority:** P1 · **Status:** pending · **Effort:** 3h
- Replace bearer-header auth with an `access_token` httpOnly cookie; add `POST /api/users/refresh` (stateless rotation) and `POST /api/users/logout`.
- Merged into one phase deliberately: a split leaves an intermediate state where the macro reads a cookie nothing sets — every authed route 401s and nothing compiles into a working app.

## Key insights

- `resolve()` inside an Elysia macro receives the full context, so `resolve({ cookie })` works the same as in a handler (report §1). Do **not** declare a `cookie` schema on the macro — [elysia#1375](https://github.com/elysiajs/elysia/issues/1375) drops cookie type inference when a macro has both a cookie schema and a resolve. Read `cookie.access_token?.value` and treat it as `string | undefined`.
- `UserService.login()` at `packages/api/src/modules/user/service.ts:52-67` currently signs the JWT. Move signing out: services must not know about HTTP transport, and `service.ts` has no `cookie` in scope. `login()` returns the public user only.
- The `DUMMY_HASH` timing-safety pattern (`service.ts:14`, `service.ts:57`) is load-bearing — the `Bun.password.verify` against `DUMMY_HASH` must still run for a missing user. **Do not restructure `login()`'s early-return shape.**
- `errorMiddleware` (`packages/api/src/middlewares/errorMiddleware.ts:6-9`) maps `HttpError` → status. Throw `UnauthorizedError` from `/refresh`; never `set.status` inline (AGENTS §6).

## Requirements

**Functional**
1. `authMacro.checkAuth(roles)` reads the JWT from the `access_token` cookie, verifies against `JWT_SECRET`, 401 on missing/invalid/expired, 403 on role mismatch. Bearer header no longer read.
2. `POST /api/users/login` sets both cookies, responds `200 { user }`.
3. `POST /api/users/refresh` — no `checkAuth` (the access token is expired by definition). Reads `refresh_token` cookie, verifies against `JWT_REFRESH_SECRET`, looks the user up by id, signs a **new pair**, sets both cookies, responds `200 { user }`. On any failure: clear both cookies, throw `UnauthorizedError`.
4. `POST /api/users/logout` — no auth required (must work with an expired access token). Clears both cookies, responds `200 { success: true }`.
5. `POST /api/users/register` unchanged (still returns `publicUser`, does not log in).

**Non-functional**
- Cookie `maxAge` derived from the signed token's `exp` claim, never re-parsed from the env string.
- `secure` on only outside development; `httpOnly: true`, `sameSite: 'strict'`, `path: '/'` always.

## Architecture / data flow

```
POST /users/login  { username, password }
  └─ userService.login()        → publicUser        (throws 401 on bad creds; DUMMY_HASH path intact)
  └─ signTokenPair(publicUser)  → { accessToken, refreshToken }
  └─ setAuthCookies(cookie, pair)  → Set-Cookie ×2
  └─ 200 { user }

any authed route
  └─ authMacro.resolve({ cookie }) reads cookie.access_token.value
     → jwt.verify(·, JWT_SECRET) → { id, role } → role check → ctx.user

POST /users/refresh   (cookie: refresh_token)
  └─ jwt.verify(·, JWT_REFRESH_SECRET) → { id }
  └─ userService.findById(id)          → 401 if row gone   ← the ONLY revocation lever we have
  └─ signTokenPair(fromDbUser)         → rotated pair, role re-read FROM DB
  └─ setAuthCookies → 200 { user }
  └─ on any throw: clearAuthCookies + 401

POST /users/logout → clearAuthCookies → 200 { success: true }
```

**Why `/refresh` hits the DB:** with no revocation table, re-reading the row on every refresh is the only way a deleted user stops getting new access tokens and the only way a role change ever takes effect. Cost is one indexed PK lookup per user per 15 min. Signing the new pair from the **DB row**, not from the refresh-token claims, is the point — do not shortcut it.

## Related code files

**Create**
- `packages/api/src/utils/auth-tokens.ts` — cookie names, `signTokenPair`, `setAuthCookies`, `clearAuthCookies`, `verifyRefreshToken`. Keep under ~80 lines.

**Modify**
- `packages/api/src/macros/auth.ts` — `resolve({ headers })` → `resolve({ cookie })` (currently line 13-15).
- `packages/api/src/modules/user/service.ts` — drop `jwt` import + `JWT_EXPIRES_IN` const (lines 2, 10); `login()` returns `this.toPublic(user)` instead of `{ user, jwt }` (line 66).
- `packages/api/src/modules/user/model.ts` — extract `publicUser` to a standalone const, reuse it; `loginResponse` becomes `t.Object({ user: publicUser })`; add `logoutResponse: t.Object({ success: t.Boolean() })`.
- `packages/api/src/modules/user/index.ts` — login handler sets cookies; add `/refresh` and `/logout` routes with `response` schemas + `detail.tags`.

**Delete:** none. **Entities:** none — no schema diff, no migration (`packages/api/AGENTS.md` §8).

## Implementation steps

1. Create `utils/auth-tokens.ts`:
   - `export const ACCESS_COOKIE = 'access_token'`, `REFRESH_COOKIE = 'refresh_token'`.
   - `signTokenPair({ id, role })` → signs access with `process.env.JWT_SECRET!` / `JWT_EXPIRES_IN ?? '15m'`, refresh with `process.env.JWT_REFRESH_SECRET!` / `JWT_REFRESH_EXPIRES_IN ?? '30d'`. Keep the existing `as jwt.SignOptions['expiresIn']` cast (the reason is documented at `service.ts:9`). Read `process.env` **inside** the function, not at module scope, so a missing var surfaces at the boot check rather than at import order.
   - `maxAgeOf(token)` → `(jwt.decode(token) as { exp: number }).exp - Math.floor(Date.now() / 1000)`.
   - `cookieOptions()` → `{ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}) }`.
   - `setAuthCookies(cookie, pair)` → `cookie[ACCESS_COOKIE].set({ value, maxAge, ...cookieOptions() })` for each (report §1 Pattern B).
   - `clearAuthCookies(cookie)` → `cookie[X].set({ value: '', maxAge: 0, ...cookieOptions() })` for each. Use an explicit `maxAge: 0` set rather than `.remove()` so the `domain`/`path` attributes match what was written — a mismatched clear silently leaves the cookie in the browser.
   - `verifyRefreshToken(token)` → `jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { id: number }`.
2. `macros/auth.ts`: swap the resolve source. Keep the existing try/catch → `UnauthorizedError` shape and the `roles.includes(decoded.role)` → `ForbiddenError` check verbatim; only the token *source* changes.
   ```
   const token = cookie[ACCESS_COOKIE]?.value
   if (!token) throw new UnauthorizedError('Missing access token')
   ```
3. `service.ts`: strip signing. `login()` body keeps `findOne` + `Bun.password.verify(password, user?.password ?? DUMMY_HASH, 'bcrypt')` + combined `if (!user || !passwordOk)` throw, then `return this.toPublic(user)`.
4. `model.ts`: extract `publicUser`, rewrite `loginResponse`, add `logoutResponse`.
5. `modules/user/index.ts`:
   - login: `async ({ body, cookie, userService }) => { const user = await userService.login(body); setAuthCookies(cookie, signTokenPair(user)); return { user } }`.
   - refresh: reads cookie, verifies, `findById`, `NotFoundError`→ catch and rethrow as `UnauthorizedError`, sets cookies, returns `{ user }`. Wrap the whole body so **every** failure path calls `clearAuthCookies(cookie)` first.
   - logout: `({ cookie }) => { clearAuthCookies(cookie); return { success: true } }`.
   - Controller keeps `.use(authMacro).use(setup)` (AGENTS §3) — `/refresh` and `/logout` simply omit the `checkAuth` option.
6. `bunx tsc --noEmit` in `packages/api`.

## Todo list

- [ ] `utils/auth-tokens.ts` created, <80 lines
- [ ] `macros/auth.ts` reads `access_token` cookie; bearer path removed
- [ ] `service.ts` login returns `publicUser`; `DUMMY_HASH` verify still unconditional
- [ ] `model.ts`: `publicUser` extracted, `loginResponse` = `{ user }`, `logoutResponse` added
- [ ] `/login` sets both cookies
- [ ] `/refresh` route: verify → DB lookup → rotate → set cookies; clears cookies on every failure path
- [ ] `/logout` route clears both cookies, no auth required
- [ ] `bun run check-types` clean in `packages/api`

## Success criteria

- `curl -i -X POST /api/users/login -d '{...}'` returns two `Set-Cookie` headers, both containing `HttpOnly` and `SameSite=Strict`, and a body with **no** `jwt` field.
- `curl -b cookies.txt /api/users/me` → 200. Same call with the bearer header only and no cookie → **401** (proves the old transport is gone).
- `curl -b cookies.txt -X POST /api/users/refresh` → 200 + two fresh `Set-Cookie` values that differ from the originals.
- `POST /api/users/refresh` with no cookie → 401 + two `Set-Cookie` clears (`Max-Age=0`).
- `POST /api/users/logout` with no cookie at all → 200, still emits both clears.
- Deleting the user row, then `POST /refresh` → 401.

## Risk assessment

| Risk | L×I | Mitigation |
|------|-----|------------|
| `cookie` typed as `Record<string, Cookie<string \| undefined>>` in the macro resolve, breaking `tsc` (elysia#1375) | M×M | No cookie schema on the macro; optional-chain the read. If inference still breaks, inline a `cookie` schema on the *route*, not the macro. |
| `clearAuthCookies` doesn't actually clear because `domain`/`path` differ from write time | M×H | Share one `cookieOptions()` between set and clear — enforced by construction. Verify with the `Max-Age=0` assertion above. |
| `jwt.decode` returns `null`/no `exp` → `maxAge` `NaN` → cookie dropped | L×H | `signTokenPair` always sets `expiresIn`, so `exp` always exists. Add a `Number.isFinite` guard that throws rather than emitting a broken cookie. |
| A `/refresh` failure path forgets to clear cookies → client loops forever on a poisoned refresh token | M×H | Single try/catch wrapping the handler body; clear-then-throw in the catch. Covered by the "no cookie → 401 + clears" success criterion. |
| Rotation race: two tabs refresh simultaneously, one pair overwrites the other | M×L | Stateless rotation with no reuse detection ⇒ both pairs remain valid until expiry; last Set-Cookie wins. Harmless by design. Client-side dedupe added in Phase 03. |

## Security considerations

- Separate secrets prevent access↔refresh type confusion (report §4). Never fall back to `JWT_SECRET` if `JWT_REFRESH_SECRET` is unset — Phase 02 makes it a hard boot requirement instead.
- `/logout` is intentionally unauthenticated. It only clears the caller's own cookies; `SameSite=Strict` blocks a cross-site forced-logout.
- No refresh-token revocation list — an exfiltrated refresh token is valid for up to 30 days. Explicitly out of scope this round; the DB lookup in `/refresh` means deleting the user row is the emergency lever.
- `role` for a new access token is read from the DB row, so a demotion takes effect within one access-token lifetime (≤15 min), not 30 days.

## Next steps

Phase 02 (env + CORS) — **must** land before anything in `apps/client` is touched, and `bunx turbo build --filter=api` must run after both.
