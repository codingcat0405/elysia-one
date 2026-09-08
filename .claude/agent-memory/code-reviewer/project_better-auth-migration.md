---
name: project-better-auth-migration
description: Elysia One's JWT-to-Better-Auth migration (commit 971e738..954bca4) — architecture and deferred findings
metadata:
  type: project
---

`packages/api` and `apps/client` migrated from hand-rolled JWT/httpOnly-cookie auth to Better Auth (username/password + optional Google OAuth), using the community `better-auth-mikro-orm@0.5.0` adapter over the existing MikroORM/Postgres pool. Reviewed at commit range 7282449..954bca4 (2026-09-07), Stage 2 code-quality pass — see `plans/260907-0946-better-auth-migration/` (since removed from git tracking, `.gitignore` now excludes `/plans/`) for the original plan.

Key architecture (also documented in root/`packages/api`/`apps/client` `AGENTS.md`, don't duplicate research — just re-read those files, they're accurate as of this migration):

- `better-auth-mikro-orm@0.5.0` calls `orm.em.*` directly (does not fork the EntityManager) — every call site (`index.ts`'s `.mount()`, `macros/auth.ts`'s `checkAuth`) wraps `auth.api.*`/`auth.handler` in `RequestContext.create(orm.em, () => ...)`. Confirmed only 2 call sites exist (`grep -rn "auth\.api\.\|auth\.handler" packages/api/src`), both correctly wrapped.
- `user.additionalFields.role` uses `input: false` — the actual privilege-escalation defense, verified correctly configured in `packages/api/src/auth.ts`.
- `AuthAccount`'s sensitive fields (`password`, `accessToken`, `refreshToken`, `idToken`) are deliberately NOT `hidden: true` (breaks the adapter's internal reads via MikroORM `serialize()`) — compensating control is "no route ever returns an AuthAccount entity", verified true across the diff.

**Deferred/unresolved findings from that review** (not yet fixed as of 954bca4):

- No `@Index()` on `AuthSession.userId` or `AuthAccount.userId` (plain `@Property()`, no index) — Better Auth will filter by these FK-shaped columns (e.g. session/account lookups by user) and there's no explicit index; only `@Unique()` fields (`AuthSession.token`, `AuthUser.email/username`) get an index automatically via MikroORM. Worth an index migration if this ever goes to real production load.
- Zustand `useUserStore` (`apps/client/src/stores/user-store.ts`) is a module-scope singleton, process-global under SSR (Bun/Node long-running process) — currently safe only because `setUser`/`clearUser` are never called from a route `loader` (only from `useEffect`/click handlers, which don't run during SSR). This is a fragile, undocumented-in-code invariant relying on future contributors not adding a `setUser` call inside a loader; `apps/client/AGENTS.md` §5.5 does call this out explicitly as a rule, so treat any PR that adds a `loader`-side store write as a regression to flag.
- `clientOrigins` (CORS allowlist / Better Auth `trustedOrigins`) is computed independently and identically in both `packages/api/src/index.ts` and `packages/api/src/auth.ts` — a DRY smell; if one is edited without the other they silently diverge. Low priority, flagged not fixed.
- `AuthApi`'s hand-written `signUpEmail`/`signInUsername` interface methods (`packages/api/src/auth.ts`) are declared but never called anywhere server-side (the frontend calls Better Auth's mounted HTTP handler directly via `better-auth/react`, not `auth.api.*` in-process) — dead type surface, YAGNI-adjacent, low priority.
