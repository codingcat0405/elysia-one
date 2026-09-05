# Phase 04 — Frontend SSR route guards

## Context links

- Invariants: `apps/client/AGENTS.md` §3 (`user.id === 0` sentinel), §4 (`_authed.tsx` is the only auth+hydrate point), §5 (**being changed** — `ssr: false` rule)
- Depends on `unwrapAuthed` from [Phase 03](./phase-03-frontend-eden-transport.md)

## Overview

- **Priority:** P1 · **Status:** pending · **Effort:** 1.5h · **Blocks on:** Phase 03
- Drop `ssr: false` from all three auth routes and make the guards async, server-capable, and free of server-side global writes.

## Key insights

- The synchronous `getToken()` pre-check disappears by necessity — an httpOnly cookie is unreadable from JS. `_authed.tsx:11-13` and the mirrored `login.tsx:16-18` / `register.tsx:15-17` guards all go.
- With cookies, `ssr: false` is no longer needed anywhere: the browser sends the auth cookie on the SSR document request, and Phase 03 forwards it to the API. Auth is enforced before HTML ships — no flash of protected content.
- **`useUserStore` is a module-level Zustand store, i.e. process-global on the SSR server.** `_authed.tsx:21` currently calls `useUserStore.getState().clearUser()` inside the loader. Once the loader runs on the server, that mutates state shared by every concurrent SSR request. `setUser` is safe today only because it lives in a `useEffect` (`_authed.tsx:32-34`). **Rule for this phase: the loader/beforeLoad must never touch the store on the server.** Loader data is the transport; the `useEffect` is the only writer.
- `throw redirect()` works in both `beforeLoad` and `loader`, on server and client — that is why the redirect lives here and not in `eden-client.ts`.

## Requirements

1. `_authed` renders only for an authenticated request; otherwise redirect to `/login` before HTML ships.
2. `/login` and `/register` redirect to `/` when the request is already authenticated.
3. If the API is unreachable (or any non-auth error occurs), `/login` and `/register` must **still render** — a down API must not make signing in impossible to reach.
4. No server-side writes to the Zustand store.

## Architecture / data flow

```
shared helper  fetchMe(): Promise<User | null>
  └─ unwrapAuthed(h => api.users.me.get({ headers: h }))
     └─ 401 → one refresh → one retry   (SSR: Set-Cookie forwarded to browser)
  └─ returns null on ANY failure (401, 5xx, network) — callers decide what that means

_authed.beforeLoad/loader:  const me = await fetchMe()
                            if (!me) throw redirect({ to: '/login' })
                            return { user: me }
                            → useEffect(setUser)  [client only]

login/register.beforeLoad:  if (await fetchMe()) throw redirect({ to: '/' })
                            // null → fall through and render the form
```

`fetchMe()` collapsing every failure to `null` is what satisfies requirement 3: an API outage makes `/login` render (correct) and `_authed` redirect to `/login` (correct — fail closed on protected routes, fail open on public ones).

Where `fetchMe` lives: `lib/eden-client.ts` if it stays small, otherwise a new `lib/current-user.ts`. It must not live in a route file — all three routes need it, and duplicating it is the DRY violation that lets the guards drift apart.

## Related code files

**Modify**
- `apps/client/src/routes/_authed.tsx`
- `apps/client/src/routes/login.tsx`
- `apps/client/src/routes/register.tsx`
- `apps/client/src/routes/__root.tsx` — add `loader: async () => ({ user: await fetchMe() })`
- `apps/client/src/components/Header.tsx` — initial render from root loader data, seed store on mount

**Possibly create**
- `apps/client/src/lib/current-user.ts` — only if `eden-client.ts` would exceed ~150 lines.

**Not touched:** `stores/user-store.ts` (`clearUser` already exists at `user-store.ts:26`; the sentinel model is unchanged), `routes/_authed/index.tsx`, `routes/__root.tsx`.

## Implementation steps

1. Add `fetchMe()` per the flow above.
2. `_authed.tsx`: remove `ssr: false`, remove the `beforeLoad` block, remove the `clearToken`/`getToken` import. Loader → `const user = await fetchMe(); if (!user) throw redirect({ to: '/login' }); return { user }`. **Delete the `useUserStore.getState().clearUser()` call from the loader** (line 21) — it is now a server-side global write. The store is cleared by `unwrapAuthed` on the client and by `Header`'s logout; a server-rendered redirect to `/login` never needs it because the store on the client was never populated for that request.
3. `login.tsx`: remove `ssr: false` and the `getToken` guard; `beforeLoad: async () => { if (await fetchMe()) throw redirect({ to: '/' }) }`. In `handleLogin`, drop `setToken(data.jwt)` (line 29) — the cookie is already set by the login response and there is nothing left to store. Keep `setUser(data.user)`. Also delete the stray `console.log(data)` at line 28.
4. `register.tsx`: same guard change; drop `setToken(data.jwt)` (line 29). The register→auto-login sequence (lines 26-28) is otherwise unchanged.
5. Update the stale comments in all three files that explain `ssr: false` / localStorage.
6. `bun run check-types`, `bun run lint`, `bun run build`.

## Todo list

- [ ] `fetchMe()` helper, single definition, used by all three routes
- [ ] `_authed.tsx`: no `ssr: false`, no `beforeLoad`, no store write in the loader
- [ ] `login.tsx`: async `beforeLoad`, no `setToken`, no `console.log`
- [ ] `register.tsx`: async `beforeLoad`, no `setToken`
- [ ] No `#/lib/auth.ts` imports remain anywhere
- [ ] Stale `ssr: false`/localStorage comments rewritten
- [ ] `__root.tsx` loader calls `fetchMe()`, exposes `user` via loader data
- [ ] `Header.tsx` renders initial user from root loader data; seeds store via mount `useEffect`; post-hydration reads/writes still go through `useUserStore`
- [ ] `check-types`, `lint`, `build` clean

## Success criteria

- Logged-out hard request to `/` → HTTP 302/307 to `/login`, or `/login` HTML, with **no** protected markup in the response body (`curl -s localhost:3001/ | grep -c '<protected marker>'` → 0).
- Logged-in hard request to `/` → the response HTML already contains the authed content (verify with `curl -b` using the real cookies, not just DevTools).
- Logged-in hard request to `/login` → redirected to `/`.
- Logged-out hard request to `/login` → the form renders.
- API stopped → `/login` still renders the form; `/` still redirects to `/login`.
- Two different users hitting `/` concurrently in two browsers see their own username — the cross-request-state check.
- Client-side navigation `/` → `/login` → `/` behaves identically to the hard-load cases.

## Risk assessment

| Risk | L×I | Mitigation |
|------|-----|------------|
| Server-side Zustand write leaks one user's identity into another concurrent SSR request | M×**H** | Step 2 deletes the only such call; the concurrent-two-users success criterion is the regression test. |
| `beforeLoad` on `/login` adds an API round-trip to every visit, and hard-fails the page if it throws | M×M | `fetchMe()` returns `null` on any error and never throws; requirement 3 has an explicit success criterion. |
| Hydration mismatch: `Header` (in `__root`, always SSR'd) reads the store, which is empty on the server → header renders logged-out, then flips after hydration | **H**×L | **Resolved** — root loader now supplies the initial user; see "Resolved: Header SSR flash" above. |
| A refresh triggered during `beforeLoad` on `/login` succeeds and redirects a user who thought they were logged out | L×L | Correct behaviour: they *are* logged in. Logging out clears both cookies. |
| Removing `ssr: false` exposes some other browser-only assumption in a child route | L×M | `routes/_authed/index.tsx` is the only child; check it for `window`/`localStorage` before removing the flag. |

## Security considerations

- Auth is now enforced server-side before HTML is generated, which is strictly stronger than the previous client-only check — protected markup can no longer be observed by disabling JS.
- The `_authed` loader is the sole authority. Do not reintroduce per-route auth checks (`apps/client/AGENTS.md` §4).
- Redirect targets are hardcoded string literals (`/login`, `/`); no user-controlled `redirect` search param is introduced, so there is no open-redirect surface. If a "return to where I was" feature is added later, the target must be validated as a same-origin relative path.

## Resolved: Header SSR flash (user decision)

**Fix now, via `__root.tsx` loader.** Add a `loader: async () => ({ user: await fetchMe() })` to `Route` in `__root.tsx`; `RootDocument`/`Header` reads it via `Route.useLoaderData()` instead of `useUserStore` directly for its initial render, so the very first SSR pass already knows the logged-in state. This is a **second** `fetchMe()` call per request (root loader + `_authed` loader both call it) — both are cheap (one `/users/me`, itself one JWT verify + no DB hit on the happy path) and TanStack Router does not dedupe loaders across route levels, so accept the duplicate call rather than engineering shared request-level caching for it (YAGNI).

Sync note: `Header` should still call `useUserStore` for **post-hydration** updates (login/logout without a full reload must still update it), so keep `setUser`/`clearUser` flowing through the store as before — only the *initial* SSR render source changes from "store (empty on server)" to "root loader data". A `useEffect` in `Header` (mirroring `_authed.tsx`'s existing pattern) seeds the store from the root loader's user on mount so subsequent client-side nav still works off the store.

Added to this phase's scope:
- `apps/client/src/routes/__root.tsx` — add the loader above.
- `apps/client/src/components/Header.tsx` — read initial user from `Route.useLoaderData()` (root route), seed `useUserStore` from it in a mount-time `useEffect`, render off the store thereafter.

## Next steps

Phase 05 — docs sync and full end-to-end verification.
