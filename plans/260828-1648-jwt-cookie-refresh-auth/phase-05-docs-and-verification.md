# Phase 05 — Docs sync + end-to-end verification

## Context links

- All prior phases. Root `AGENTS.md` §"Auth model" is the canonical statement this change invalidates.

## Overview

- **Priority:** P1 · **Status:** pending · **Effort:** 1h · **Blocks on:** Phase 04
- Every AGENTS/README statement about localStorage + bearer tokens is now false. Leaving them is worse than having no docs — future agents will follow them and reintroduce the old transport.

## Requirements

Update every documented claim invalidated by this change, then run the full manual test matrix (there is no automated test suite — `packages/api/AGENTS.md` §"Before you finish" is explicit that `bun test` is a placeholder; do not pretend otherwise).

## Related code files

**Modify**
| File | What is now false |
|------|-------------------|
| `AGENTS.md` (root) :28-30 | "no server-side session and no cookie… sent as `Authorization: Bearer`". Rewrite the whole Auth model section: two httpOnly cookies, two secrets, stateless rotation, `/refresh` + `/logout`, `SameSite=Strict` limitation. Keep the "don't introduce a second auth mechanism" warning, re-pointed at the cookie model. |
| `AGENTS.md` (root) :49-52 | Env list — add `JWT_REFRESH_SECRET` (required), `CLIENT_URL`, `COOKIE_DOMAIN`. |
| `packages/api/AGENTS.md` :68 | Bull Board rationale says "an API client that already carries a bearer token" — reword. |
| `packages/api/AGENTS.md` | Add an invariant: auth cookies are set in exactly one place (`utils/auth-tokens.ts`); services stay HTTP-agnostic and never touch `cookie`. |
| `apps/client/AGENTS.md` :11-13 (§2) | **Delete and replace.** "Auth token: only through `lib/auth.ts`" — that module no longer exists. Replacement rule: the token is httpOnly and unreadable from JS; auth state comes from `/users/me` via `unwrapAuthed`, never from storage. |
| `apps/client/AGENTS.md` :19-21 (§4) | `_authed.tsx` no longer "guards with `beforeLoad` on `getToken()`"; describe the SSR loader guard. |
| `apps/client/AGENTS.md` :23-25 (§5) | **Inverted.** Was "auth-sensitive routes are `ssr: false`". Now: auth routes are SSR-enabled *because* the cookie reaches the server; new auth-touching routes must not add `ssr: false`. Add the module-scope-state warning (Zustand/dedupe promise are process-global on the SSR server). |
| `README.md` (root) :9 | "JWT auth (bearer token in `localStorage`)". |
| `apps/client/README.md` :11, :34, :36, :37 | Four separate localStorage/bearer claims. |
| `packages/api/README.md` :3, :10, :47, :113, :138-139 | Auth summary, setup line, `auth.ts` macro description, Bull Board rationale, env table (`JWT_EXPIRES_IN` default `1d`→`15m`, add the 4 new vars). |

**Also add** a short "Deploying with cookie auth" subsection to `packages/api/README.md`:
- `CLIENT_URL` must be the exact browser origin — a wildcard breaks credentialed CORS silently.
- `COOKIE_DOMAIN` must be the shared parent domain when the client and API are on different subdomains, otherwise SSR never sees the cookie.
- The client and the API must share a registrable domain — `SameSite=Strict` makes a genuinely cross-site split unworkable without adding `SameSite=None` + a CSRF token scheme.
- `NODE_ENV=production` is what turns on the `Secure` flag.

## Implementation steps

1. Rewrite root `AGENTS.md` Auth model + Env files sections.
2. Rewrite `apps/client/AGENTS.md` §2, §4, §5.
3. Add the `auth-tokens.ts` invariant to `packages/api/AGENTS.md`; fix the §10 bearer wording.
4. Fix the three READMEs; add the deployment subsection and the env table rows.
5. Run the verification matrix below.
6. `grep -rn "localStorage\|Bearer\|getToken" AGENTS.md README.md apps/client packages/api --exclude-dir=node_modules --exclude-dir=dist` → only intentional historical mentions remain.

## Verification matrix (manual, no automated suite exists)

| # | Scenario | Layer | Expected |
|---|----------|-------|----------|
| 1 | `POST /login` valid creds | api (curl) | 200, body `{ user }` with **no** `jwt`, two `Set-Cookie` with `HttpOnly; SameSite=Strict` |
| 2 | `POST /login` bad creds | api | 401, no `Set-Cookie`, same message/latency as an unknown username (`DUMMY_HASH` path intact) |
| 3 | `GET /me` with cookie | api | 200 |
| 4 | `GET /me` with bearer header only | api | **401** — old transport is gone |
| 5 | `GET /me` with a *refresh* token in the `access_token` cookie | api | 401 — proves the two secrets are distinct |
| 6 | `POST /refresh` valid | api | 200, two new `Set-Cookie` differing from the originals |
| 7 | `POST /refresh` missing/expired/tampered | api | 401 + both cookies cleared (`Max-Age=0`) |
| 8 | `POST /refresh` after deleting the user row | api | 401 |
| 9 | `POST /logout` with no cookies | api | 200 + both clears |
| 10 | OPTIONS preflight from `CLIENT_URL` | api | exact ACAO echo + `Access-Control-Allow-Credentials: true` |
| 11 | OPTIONS preflight from an unlisted origin | api | no ACAO header |
| 12 | Boot without `JWT_REFRESH_SECRET`, and with it equal to `JWT_SECRET` | api | fails fast, distinct messages |
| 13 | Browser login → check storage | client | cookies `HttpOnly`; `localStorage` empty; `document.cookie` has neither token |
| 14 | Client-side nav with an expired access token (`JWT_EXPIRES_IN=10s`) | client | `/me` 401 → `/refresh` 200 → `/me` 200, no bounce to `/login` |
| 15 | **Hard reload** with an expired access token | client SSR | authed HTML on first byte, two `Set-Cookie` on the document response, no `/login` redirect |
| 16 | Hard load of `/` while logged out | client SSR | redirect to `/login`, zero protected markup in the body |
| 17 | Hard load of `/login` while logged in | client SSR | redirect to `/` |
| 18 | API stopped, load `/login` | client SSR | form renders |
| 19 | Logout button | client | `/logout` called, cookies gone, navigated to `/login`, back-navigation does not restore the session |
| 20 | Two users, two browsers, concurrent hard loads of `/` | client SSR | each sees their own username (cross-request state check) |
| 21 | Expire the refresh token too, then hard reload | client SSR | redirect to `/login`, both cookies cleared |
| 22 | `bun run check-types` + `bun run lint` + `bun run build`, all workspaces | both | clean |

Scenarios 5, 15, 20 are the ones that catch the failure modes unique to this design — do not skip them.

## Rollback plan

Single-commit-per-phase, and the whole change is one branch. Rollback granularity:

- **Phases 03-05 only (frontend):** cannot revert independently — the backend no longer emits `jwt`, so an old client would store `undefined` and every authed call would 401. Frontend and backend must revert together.
- **Full revert:** `git revert` the branch merge. No DB migration ran (no entity changed), so there is no data to undo. Deployed users' cookies become inert; they log in again and land back in `localStorage`. Env vars added are ignored by the reverted code.
- **Partial mitigation instead of revert:** if the only problem is access-token lifetime, `JWT_EXPIRES_IN` is env-tunable with no code change.
- **The one-way door:** any non-browser client (curl/Postman/mobile) that was updated to cookies must be updated back. Communicate B3 before deploying.

## Success criteria

- All 22 matrix rows pass.
- The grep in step 6 is clean.
- A reader of the three AGENTS.md files could not implement the *old* localStorage flow from them.

## Risk assessment

| Risk | L×I | Mitigation |
|------|-----|------------|
| Docs updated but a stale claim survives and a future agent reintroduces bearer auth | M×M | The grep in step 6 is the check, not eyeballing. |
| Prod deploy missing `CLIENT_URL`/`COOKIE_DOMAIN`/`JWT_REFRESH_SECRET` | M×H | `JWT_REFRESH_SECRET` fails fast at boot. The other two fail *silently and only in production* — hence the dedicated README deployment subsection. |
| Matrix passes locally but fails in prod because localhost hides the cross-subdomain cookie problem | **H**×H | Every localhost-only assumption is called out in row-adjacent notes; the deployment subsection is the mitigation. Ideally verify once on a real staging domain before calling this done. |

## Unresolved questions

1. Phase 04 Q1 (Header SSR logged-out flash) — carry forward if still undecided.
2. Should `bun test` finally get real coverage for the auth flow, given the matrix above is entirely manual and rows 5/15/20 are easy to regress silently? Out of scope for this plan, but this change materially raises the cost of having no tests.
