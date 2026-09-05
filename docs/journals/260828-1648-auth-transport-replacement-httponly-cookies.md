# Auth Transport Replacement: Bearer Token to httpOnly Refresh+Access Cookie Pair

**Date**: 2026-08-28 16:48
**Severity**: High (Breaking change to entire auth flow)
**Component**: API (`packages/api/src/middleware/auth.ts`, `src/routes/auth.ts`), Client (`apps/client/src/middleware/auth-ssr.ts`, `src/utils/auth.ts`)
**Status**: Merged (commit `971e738` on `main`)

## What Happened

Replaced the entire authentication transport in a Bun+Turborepo monorepo (Elysia+MikroORM backend, TanStack Start frontend) from a single JWT stored in localStorage with a bearer Authorization header to a stateless, dual-JWT architecture: short-lived access token (15m) + long-lived refresh token (30d), both httpOnly/Secure cookies, with automatic rotation on SSR-protected routes and no DB-backed token revocation table.

The plan (`/plans/260828-1648-jwt-cookie-refresh-auth/`) was fully implemented in 5 phases: setup, core JWT generation, SSR auth guards, refresh endpoint, and client-side integration. Committed as `feat!: replace bearer token auth with httpOnly refresh+access token pair`.

## The Brutal Truth

This is a **breaking change** that touches every authenticated request in both frontend and API. We shipped it without running the full end-to-end verification matrix (22 scenarios, plan phase-05) because Docker wasn't available and Redis wasn't running locally. That's a real gap—the scenarios we flagged as most likely to catch unique failure modes (concurrent SSR request isolation, refresh-token confusion, bearer-header rejection timing) have never been empirically exercised. We're relying on static verification (type-check, lint, code review) and hoping the design assumptions hold.

The frustration here is that **we made the right call at the plan stage** (caught a critical design flaw: SSR just-reads-and-redirects would have silently broken the 30-day refresh token's entire point), but then didn't complete the verification we knew was necessary. If a subtle race condition exists in the refresh flow or the SSR header-merge logic breaks under concurrent loads, we won't know until it's in production.

The design's CSRF mitigation (`SameSite=Strict` only, no CSRF tokens) is also a permanent architectural lock-in for this template: it requires frontend and API to share a registrable domain forever. A genuinely cross-site topology doesn't work without complete redesign later.

## Technical Details

**JWT Architecture:**
- Dual secrets (`JWT_SECRET` for access, `JWT_REFRESH_SECRET` for refresh) enforced with boot-time equality check to prevent cross-token replay attacks.
- Access tokens: 15-minute TTL, verified on every request.
- Refresh tokens: 30-day TTL, automatically rotated on `/refresh` endpoint.
- Stateless design: no DB token revocation table. Only revocation lever is deleting the user or changing roles (takes effect within one refresh cycle). A stolen refresh token stays valid for its full 30-day life.

**SSR Route Guard (non-obvious design decision):**
```
POST /refresh request-response.ts auto-merges Set-Cookie headers from our route handler into the response.
If access token expired but refresh token valid:
  1. SSR route guard detects expired token
  2. Calls /refresh internally (within same request context)
  3. Rotates tokens server-side
  4. Merges Set-Cookie into response sent to browser
  5. Continues rendering with fresh cookies available to subsequent client requests
```
Naive alternative (which we caught and rejected at plan time): "SSR just checks, redirects on failure." This would have been a trap — any hard reload >15 minutes after login but <30 days would bounce to `/login` despite valid refresh token, silently defeating the entire 30-day refresh window's purpose. The user explicitly confirmed they wanted SSR to be auth-aware, not client-only.

**CSRF Mitigation:**
`SameSite=Strict` on both cookies, no CSRF token scheme. Explicit scope cut for template simplicity. Real consequence: requires same registrable domain at production time.

## What We Tried

1. **Initial plan:** SSR route guard with simple read-then-redirect pattern.
   - **Why it failed:** Caught mid-plan via clarifying question — user confirmation led to redesign before any code written. Avoided implementation rework entirely.

2. **Bearer-header double-rejection handling:** Catch-all error handler.
   - **Bug caught in code review:** `/refresh` endpoint wrapped both auth failures (forged token) and incidental DB errors in single 401 response with no distinguishing log. Transient DB blip looked identical to token forgery in logs.
   - **Fixed:** Added explicit `logger.error` on non-auth-error branch for observability.

3. **SSR hydration state inference from `user.id === 0`:**
   - **Bug caught in code review:** Couldn't distinguish "store not yet hydrated" from "user just explicitly logged out" — logout could flash old username until next navigation.
   - **Fixed:** Added explicit `hydrated` boolean state in Header component.

4. **Library-behavior assumptions (TanStack request-response header merging, Eden client header priority):**
   - **Unresolved at plan stage:** Two questions flagged as unverifiable without live run.
   - **Actually resolved in code review:** Reviewer pulled actual library source and read documentation instead of guessing. Both confirmed to work as assumed.

## Root Cause Analysis

Why did we ship without the live verification matrix?

1. **Environment not available:** No Redis locally, no Docker permissions to start it.
2. **User prioritized delivery over environment setup:** Asked directly, user chose static verification over session-blocking setup.
3. **Plan explicitly flagged this gap but didn't block:** Scenarios 5, 15, 20 (bearer rejection timing, concurrent SSR isolation, refresh cycle edge cases) were documented as high-value to test but marked as "if available" not "must have."

Root cause: We treated "unresolved questions" at plan time as "answer them in code review" rather than "these are blocker verifications." That's reasonable for YAGNI, but it left a real gap for a breaking change to the auth flow itself.

## Lessons Learned

1. **Design correctness ≠ implementation correctness.** Even when the plan catches a design flaw at architecture stage (SSR refresh trap), that's only valuable if the resulting code is verified. Static review caught two real bugs, but concurrent/timing bugs are harder to catch without a live run.

2. **Stateless designs need explicit revocation policy.** We chose "deleted user/role change = only revocation lever," which is honest but limits defensiveness against token theft. Document this explicitly for security reviewers.

3. **CSRF mitigation choice locks in topology.** `SameSite=Strict` only works with same-domain frontend+API. If topology changes later, this becomes a breaking change. Worth a comment in the code or docs warning about this.

4. **"Unresolved question" ≠ "nice to have."** When a question involves a breaking feature touching every request, the answer should be empirically verified, not just "code review will catch it." Better: pre-plan phase to verify library behavior or do a spike.

5. **Code review is excellent for logic bugs, weak for concurrency/timing.** The two bugs caught (hydration state, error handling) were both logic bugs in synchronous paths. The SSR refresh rotation logic is async and involves multiple state transitions — exactly the kind of thing that needs live testing.

## Next Steps

1. **Run the live verification matrix (plan phase-05, all 22 scenarios, prioritize 5/15/20).** Setup Redis locally or via Docker, execute manual test matrix before this sees production load. This is the clear blocker for confidence.
2. **Add observability hooks** around refresh rotation (log token age, rotation count per session) to catch timing issues post-deploy if they exist.
3. **Document CSRF topology requirement** in `docs/deployment-guide.md` and `docs/code-standards.md` so future devs understand the `SameSite=Strict` lock-in.
4. **Consider adding a post-deployment audit** for token exfiltration (unusual refresh patterns, tokens refreshing from unexpected IPs).

---

**Unresolved Questions:**
- Will concurrent SSR requests on the same session correctly isolate the refresh rotation, or will request A's refresh overwrite request B's in-flight token? (Not tested empirically, only reviewed the code path.)
- Does the exact timing of when TanStack's request-response handler merges Set-Cookie headers into the response stream match our assumptions about when the browser will see the cookies? (Code review confirmed library behavior, but live SSR timing is always surprising.)
