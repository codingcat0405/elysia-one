# Phase 03 — Frontend transport (eden-client cookies, SSR forwarding, 401 refresh-retry)

## Context links

- Research: [`researcher-260828-1635-elysia-cookie-jwt-refresh-report.md`](../reports/researcher-260828-1635-elysia-cookie-jwt-refresh-report.md) §3 (Eden `fetch: { credentials: 'include' }`, eden#126)
- Invariants: `apps/client/AGENTS.md` §1 (only `lib/eden-client.ts` talks to the API), §2 (**this rule is being deleted** — rewritten in Phase 05), §7

## Overview

- **Priority:** P1 · **Status:** pending · **Effort:** 3h · **Blocks on:** Phase 02 + `bunx turbo build --filter=api`
- Hardest phase. Three separate concerns land in `lib/eden-client.ts`: browser cookie credentials, SSR cookie forwarding, and refresh-on-401 retry that works in **both** environments.

## Key insights (verified)

- TanStack Start server utilities are re-exported from `@tanstack/react-start/server` and are **server-only — they throw if called outside a server request context**. Verified names against the installed toolchain via `bunx @tanstack/intent@latest load '@tanstack/start-server-core#start-server-core'` (doc `library_version: 1.169.17`; installed `@tanstack/react-start ^1.168.49`): `getRequest`, `getRequestHeaders`, `getRequestHeader`, `setResponseHeader`, `setResponseHeaders`, `getCookies`, `getCookie`, `setCookie`, `deleteCookie`.
- `createIsomorphicFn().server(fn).client(fn)` from `@tanstack/react-start` is the sanctioned environment split, with dead-code elimination handled by the Vite plugin (verified via `'@tanstack/start-client-core#start-core/execution-model'`). This is what keeps `@tanstack/react-start/server` out of the client bundle.
- **Route loaders run on BOTH server and client** — that is the whole reason this phase exists. Eden's `credentials: 'include'` only means anything in a browser; during SSR there is no cookie jar, so the incoming request's `Cookie` header must be forwarded by hand.
- Consumers of the module being deleted — `grep -rn "getToken\|setToken\|clearToken"` gives exactly 4 files: `lib/eden-client.ts:3,9`, `routes/login.tsx:9,17,29`, `routes/register.tsx:9,16,29`, `routes/_authed.tsx:3,12,20`, plus `components/Header.tsx:4,13`. That is the complete list; nothing else in `apps/client/src` reads the token.
- `unwrap()` (`lib/eden-client.ts:22-29`) is called at 4 sites: `register.tsx:26,28`, `login.tsx:27`, `_authed.tsx:16`. Its current parameter type does not include `status`, which the retry logic needs.

## Requirements

1. Every browser request carries the auth cookies (`credentials: 'include'`).
2. Every SSR request forwards the incoming `Cookie` header to the API.
3. A 401 on an *authenticated* call triggers **one** `/users/refresh` attempt, then one retry of the original call.
4. On the server, a successful SSR-side refresh must propagate the rotated `Set-Cookie` headers to the browser **and** be used for the retry.
5. A 401 on `/login` (bad credentials) must never trigger a refresh attempt.
6. No request-derived state is ever written to module scope on the server.

## Architecture / data flow

```
                     ┌── client ──────────────────────────────────┐
  api.x.y()          │ browser attaches cookies (credentials:     │
   → treaty          │ 'include'); Set-Cookie handled by browser  │
   → headers()       └───────────────────────────────────────────┘
       │
       └── isomorphic cookie header ──┐
                     ┌── server ──────┴───────────────────────────┐
                     │ getRequestHeader('cookie') → forwarded     │
                     │ verbatim as the outgoing Cookie header     │
                     └────────────────────────────────────────────┘

unwrapAuthed(fn):
  r1 = await fn(undefined)                  // headers from global headers()
  if r1.error?.status !== 401 → unwrap(r1)
  refreshed = await doRefresh()             // POST /users/refresh
  if !refreshed → clearUser() [client only] ; throw r1.error.value
  r2 = await fn(refreshed.retryHeaders)     // server: { cookie: <rotated> } · client: undefined
  → unwrap(r2)

doRefresh() [server branch]:
  res = await api.users.refresh.post(...)
  setCookies = res.response.headers.getSetCookie()
  setResponseHeader('set-cookie', setCookies)          // → browser gets rotated pair
  retryHeaders = { cookie: setCookies.map(c => c.split(';')[0]).join('; ') }
```

**Why SSR must refresh (do not simplify this away).** If the SSR guard only *reads* auth and redirects on 401, then any hard page load more than 15 minutes after login bounces the user to `/login` even though their 30-day refresh token is perfectly valid. That turns the refresh token into decoration. The alternatives were considered and rejected: deferring the refresh to post-hydration reintroduces the flash-of-unauthenticated-content this design exists to remove, and lengthening the access token defeats the point of a short-lived access token.

**`unwrap` vs `unwrapAuthed`, and why two functions.** Keeping the existing `unwrap(promise)` unchanged means `login`/`register`/`logout` call sites do not change shape, and — more importantly — it makes "does this call participate in refresh?" a property of the call site rather than a runtime path guess. A bad-credentials 401 from `/login` can then never trigger a pointless refresh→clear→bounce. `unwrapAuthed` takes a **thunk**, not a promise, because a retry has to re-issue the call.

## Related code files

**Modify**
- `apps/client/src/lib/eden-client.ts` — the whole file. Target ~110 lines; if it passes ~150, split the SSR bits into `lib/eden-ssr-cookies.ts`.
- `apps/client/src/components/Header.tsx` — `handleLogout` (lines 4, 12-16).

**Delete**
- `apps/client/src/lib/auth.ts` — entire module. Nothing needs it: the token is no longer JS-readable, so there is nothing to store, read, or clear from the client.

## Implementation steps

1. **`eden-client.ts` — treaty config.**
   ```
   const forwardedCookie = createIsomorphicFn()
     .server(() => getRequestHeader('cookie'))
     .client(() => undefined)

   const client = treaty<App>(import.meta.env.VITE_API_URL ?? 'http://localhost:3000', {
     fetch: { credentials: 'include' },
     headers() {
       const cookie = forwardedCookie()
       return cookie ? { cookie } : undefined
     },
   })
   ```
   Drop the `getToken()` import and the `authorization` header entirely. `headers()` runs per request — never hoist `getRequestHeader` to module scope (it throws outside a request context, and module scope is shared across concurrent SSR requests).
2. **Widen `unwrap`'s parameter type** to `Promise<{ data: TData; error: { status: number; value: unknown } | null }>`. Behaviour unchanged. Keep the existing explanatory comment.
3. **`doRefresh()`** — isomorphic, returns `{ retryHeaders?: Record<string,string> } | null`:
   - Call `api.users.refresh.post(...)` through plain `unwrap` (never `unwrapAuthed` — that would recurse).
   - Client branch: on success return `{}`; the browser has already stored the rotated cookies.
   - Server branch: read `res.response.headers.getSetCookie()`, re-emit via `setResponseHeader('set-cookie', setCookies)`, and build `retryHeaders.cookie` from the `name=value` prefix of each entry.
   - Any throw → return `null`.
4. **`unwrapAuthed(fn)`** per the flow above. On terminal failure, clear the Zustand store **client-side only** (`if (typeof window !== 'undefined') useUserStore.getState().clearUser()`), then rethrow the original error. It must **not** redirect — redirects belong to the route guards in Phase 04, where `throw redirect()` actually works (it is a no-op inside an event handler).
5. **Client-only refresh dedupe.** A module-level in-flight promise so N simultaneous 401s cause one refresh. Guard it with `typeof window !== 'undefined'` and never populate it on the server: module scope on the SSR server is shared across concurrent requests, so caching one user's refresh promise there would hand their rotated cookies to another user. This is a correctness requirement, not an optimisation.
6. **Delete `lib/auth.ts`.**
7. **`Header.tsx`:** drop the `clearToken` import; `handleLogout` becomes `try { await unwrap(api.users.logout.post()) } catch {} finally { clearUser(); await navigate({ to: '/login' }) }`. Clearing local state and navigating must happen even if the network call fails — otherwise a user with no connectivity cannot log out.
8. `bun run check-types` and `bun run lint` in `apps/client`; then `bun run build` to confirm the client bundle still builds (this is what catches a leaked server-only import).

## Todo list

- [ ] `credentials: 'include'` set; `authorization` header removed
- [ ] `forwardedCookie` via `createIsomorphicFn`, read per-request
- [ ] `unwrap` param type includes `error.status`
- [ ] `doRefresh()` with server Set-Cookie passthrough + retry-header derivation
- [ ] `unwrapAuthed(thunk)` — one refresh, one retry, no redirect
- [ ] Refresh dedupe is client-only; no module-scope writes on server
- [ ] `lib/auth.ts` deleted; zero remaining references
- [ ] `Header.tsx` logout calls the API, clears state in `finally`
- [ ] `check-types`, `lint`, and `build` all clean

## Success criteria

- `grep -rn "getToken\|setToken\|clearToken\|localStorage" apps/client/src` returns nothing.
- DevTools → Application → Cookies shows `access_token` + `refresh_token` on the API origin with `HttpOnly` ticked; `localStorage` is empty.
- `document.cookie` in the console does **not** contain either token.
- Log in, wait past the access-token expiry (or temporarily set `JWT_EXPIRES_IN=10s`), click into an authed screen: Network shows `/users/me` 401 → `/users/refresh` 200 → `/users/me` 200, and the UI never bounces to `/login`.
- Same expiry scenario but with a **hard reload** (SSR path): the server-rendered HTML already contains the authed content, the response carries two `Set-Cookie` headers, and there is no `/login` redirect.
- Bad-credentials login: Network shows a single `/users/login` 401 and **no** `/users/refresh` call.
- Client production build succeeds and `@tanstack/react-start/server` does not appear in the client bundle.

## Risk assessment

| Risk | L×I | Mitigation |
|------|-----|------------|
| `createIsomorphicFn` DCE fails to strip the `@tanstack/react-start/server` import → client build error or a server module shipped to the browser | M×H | This is the sanctioned API for exactly this case. Caught by the `bun run build` gate. Fallback: move the server branch into a `lib/eden-ssr-cookies.server.ts` and reach it via `createServerOnlyFn`. |
| Per-call `headers` **replaces** rather than merges with the global `headers()` result → the retry loses other headers | M×M | `cookie` is the only header this client sets, so replacement is harmless either way. Verify empirically; do not assume merge semantics. |
| `setResponseHeader('set-cookie', array)` does not emit multiple `Set-Cookie` lines → only one of the two rotated cookies reaches the browser, so the next reload logs the user out | M×H | Assert **two** `Set-Cookie` headers in the SSR success criterion. Fallback: two `setCookie(name, value, opts)` calls — but that duplicates the backend's cookie policy in the frontend, so prefer raw passthrough and only fall back if forced. |
| `Response.headers.getSetCookie()` unavailable in the SSR runtime | L×H | Bun and Node ≥20 both have it. If missing, fall back to `getRequest()`-level header access. Verify on first run. |
| eden#126 (cookies not persisting across consecutive requests) | L×M | The report notes this; in a browser the cookie jar is the browser's, not Eden's, so the blast radius is the SSR path — which we handle by explicit header forwarding anyway. Verify empirically; do not block on it. |
| Refresh dedupe promise leaks across SSR requests | L×**H** | Hard rule in step 5: client-only. Module scope on the SSR server is process-global. |
| Infinite refresh loop if `/refresh` itself returns 401 and something re-enters `unwrapAuthed` | L×H | `doRefresh` uses plain `unwrap`; the retry is not itself wrapped. Exactly one retry, structurally. |
| `VITE_API_URL` is the *public* API URL, also used for SSR server→API calls | M×M | Works as long as the public URL is reachable from the SSR server. If a deployment needs a separate internal URL, that is a new env var — out of scope, noted in Phase 05. |

## Security considerations

- The client can no longer read, log, or exfiltrate the token via XSS — that is the primary win. Keep it that way: never add an endpoint that returns the raw token in a JSON body.
- SSR forwards the **entire** incoming `Cookie` header to the API. Acceptable today (the only cookies in play are ours), but if unrelated cookies are ever added to the client origin, narrow the forward to the two auth cookies.
- Never write request-derived data to module scope during SSR — applies to the refresh dedupe promise *and* to the Zustand store (Phase 04).

## Unresolved questions

1. `setResponseHeader` with an array for `set-cookie` — confirm it emits two headers, or find the append-style API in the installed version.
2. Should the SSR→API base URL be split from `VITE_API_URL` (an internal cluster URL for the SSR server, public URL for the browser)? Out of scope here; flagging because it becomes load-bearing on the first non-localhost deploy.

## Next steps

Phase 04 — SSR route guards, which consume `unwrapAuthed`.
