# Project Changelog

## [Unreleased]

### Changed

- **Authentication mechanism:** Migrated from httpOnly session cookies to bearer token authentication
  - Session tokens are now stored in the browser's `localStorage` under the key `elysia-one.auth_token`
  - Clients send tokens via `Authorization: Bearer <token>` header instead of relying on automatic cookie attachment
  - Fixes cross-site deployments where frontend and API are on different registrable domains
  - Better Auth's `bearer()` plugin now handles token resolution; cookie is still issued by Better Auth but unused by the app
  - **Migration note:** Existing users will be logged out once (their cookie session is valid but the new frontend has no `localStorage` token). Users must sign in once with their credentials after the deploy. No database schema changes required.

- **Frontend authentication flow:** SSR-enforced auth moved to client-side validation
  - `_authed.tsx` layout now uses a client-side mount effect (not a loader) to validate the session behind a loading state
  - No authentication decision is made during SSR; the first server render shows a loading state while the browser validates the session
  - A separate `__root.tsx` display-only sync effect populates the user store for the `Header` on public pages (never gates or redirects)
  - Consequence: first paint of authenticated pages shows a loading state until session validation completes

- **API authorization:** Unchanged in mechanism
  - `checkAuth(roles)` macro still enforces authorization at the API level on every request
  - The macro now reads bearer tokens from the `Authorization` header via `auth.api.getSession({ headers })`
  - 401/403 responses remain the security boundary

### Known Gaps

- **Google OAuth + bearer tokens:** Unsolved. OAuth callbacks are top-level redirects from `accounts.google.com`, which cannot deliver the `set-auth-token` response header to JavaScript. Google is currently disabled; re-enabling requires a separate design.
- **XSS risk:** Session tokens in `localStorage` are readable by injected scripts (cookies were `httpOnly`). Mitigation: Content Security Policy, input sanitization, code review.
- **No token refresh:** Tokens are valid until session TTL or sign-out. No auto-refresh, no sliding-window tokens.

### Deprecated

- Cookie-based session storage (still issued by Better Auth for rollback compatibility, but unused by the app)
- SSR-enforced authentication (moved to client-side guard)

### Security

- Bearer tokens are not auto-sent by the browser, reducing CSRF risk compared to cookies
- `trustedOrigins` (via `CLIENT_URL`) remains an origin allowlist for state-changing requests
- Session tokens must be cleared from `localStorage` on sign-out (server-side session delete alone is insufficient)
