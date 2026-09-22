# System Architecture

## Authentication Flow

The app uses bearer token authentication via [Better Auth](https://better-auth.com). Session tokens are stored in the browser's `localStorage` and sent with every authenticated request via the `Authorization: Bearer <token>` header.

### Backend Flow

1. **Sign-in / Sign-up:** User submits credentials to `/api/auth/sign-in/email` or `/api/auth/sign-up/email`
2. **Token Generation:** Better Auth generates a session token and returns it in the `set-auth-token` response header (exposed via `Access-Control-Expose-Headers`)
3. **Authenticated Requests:** Clients send `Authorization: Bearer <token>` headers on subsequent requests
4. **Session Resolution:** `checkAuth(roles)` macro in `packages/api/src/macros/auth.ts` calls `auth.api.getSession({ headers })` to resolve the bearer token to the session
5. **Authorization:** Role-based access control is enforced per route via the `checkAuth` macro

### Frontend Flow

1. **Token Capture:** `apps/client/src/lib/auth-client.ts` captures the `set-auth-token` header on successful sign-in/sign-up
2. **Token Storage:** `apps/client/src/lib/auth-token.ts` persists the token to `localStorage` under the key `elysia-one.auth_token`
3. **Token Attachment:** Both `authClient` (Better Auth client) and Eden Treaty (API client) automatically include `Authorization: Bearer <token>` headers when a token is available
4. **Session Validation:** The `_authed.tsx` layout route validates the session in a client-side effect before rendering authenticated pages. On invalid/missing session, it clears the token and redirects to `/login`
5. **Sign-out:** `clearAuthToken()` clears `localStorage`, ensuring the token is not sent on subsequent requests

## Trade-offs and Constraints

### Cross-site Deployment (Solved)

**Problem:** httpOnly cookies are blocked by the browser when the frontend and API are on different registrable domains (`SameSite=Lax` cookies never reach the API in cross-site scenarios).

**Solution:** Bearer tokens in `localStorage` are not subject to `SameSite` restrictions and work across any origin (as long as CORS headers permit it).

**Constraint:** `CLIENT_URL` must be the exact browser origin. It feeds into Better Auth's `trustedOrigins` allowlist — requests from any other origin on state-changing endpoints are rejected.

### XSS Risk

**Trade-off:** `localStorage` is readable by injected JavaScript, whereas the httpOnly cookie was not.

**Mitigation:** This is an accepted trade-off. The defense is "don't ship XSS" — use Content Security Policy headers, input sanitization, and code review to prevent script injection.

### No SSR-enforced Auth

**Change:** Authentication can no longer be enforced during server-side rendering. The bearer token lives in `localStorage`, which doesn't exist on the server.

**Result:** Authenticated pages show a loading state on the first server render while the browser validates the session client-side via `getSessionUser()` in the `_authed` layout guard.

**Note:** The API (`checkAuth` macro) remains the actual security boundary — 401/403 responses are returned for any unauthenticated or unauthorized request, regardless of client-side state.

### Google OAuth Gap

**Status:** Unsolved. Google OAuth is currently disabled in this environment.

**Problem:** The OAuth callback is a top-level browser redirect from `accounts.google.com`, which cannot deliver a `set-auth-token` response header to JavaScript the way a `fetch` call can.

**Future:** Re-enabling Google OAuth requires a separate design, such as a server-side callback handler that redirects with the token in a URL fragment or query parameter.

## Session Lifecycle

- **Creation:** On successful sign-in or sign-up, the `set-auth-token` header is captured and stored in `localStorage`
- **Validation:** Every request to `/api/profile/*` and other authenticated endpoints includes the bearer token in the `Authorization` header
- **Expiration:** The token is valid until the session TTL expires in the database or the user signs out
- **Termination:** On sign-out, both the server-side session and the client-side `localStorage` token are cleared

## Architecture Diagram

```
┌─────────────────────────┐
│   apps/client (React)   │
├─────────────────────────┤
│ lib/auth-token.ts       │ ← localStorage key manager
│ lib/auth-client.ts      │ ← Better Auth client
│ lib/eden-client.ts      │ ← API client
│ routes/_authed.tsx      │ ← Session validation gate
│ routes/__root.tsx       │ ← Display-only sync effect
└─────────────────────────┘
          │
          │ Authorization: Bearer <token>
          │ (via fetchOptions.headers / fetchOptions.auth)
          │
┌─────────────────────────┐
│  packages/api (Elysia)  │
├─────────────────────────┤
│ src/auth.ts             │ ← bearer() plugin registered
│ src/macros/auth.ts      │ ← checkAuth(roles) — validates token
│ src/index.ts            │ ← CORS exposeHeaders: set-auth-token
│ /api/auth/*             │ ← sign-in/sign-up (return set-auth-token)
│ /api/profile/*          │ ← role-gated endpoints
└─────────────────────────┘
          │
          │ PostgreSQL
          │
┌─────────────────────────┐
│    better-auth-mikro-orm adapter
│    (session storage)
└─────────────────────────┘
```
