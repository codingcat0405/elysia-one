import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getAuthToken, clearAuthToken } from '#/lib/auth-token.ts'
import { getSessionUser } from '#/lib/auth-client.ts'
import { useUserStore } from '#/stores/user-store.ts'

// Pathless layout wrapping every authenticated screen.
//
// The session token now lives only in localStorage — the server has no
// access to it during SSR, so auth can no longer be enforced in a loader.
// This file owns every redirect and every token invalidation for the authed
// area; `__root.tsx`'s sync effect is display-only and does neither (see its
// comment). Both server render and the client's first render show the
// `checking` placeholder below, so there is no hydration mismatch.
//
// Worst case of this trade-off: an unauthenticated visitor sees a brief
// loading placeholder before being bounced to `/login`, instead of an
// instant SSR redirect. The API's `checkAuth` still rejects every
// unauthenticated request regardless of what the browser renders — this
// guard is UX, not the security boundary.
export const Route = createFileRoute('/_authed')({
  component: AuthedLayout,
})

function AuthedLayout() {
  const [status, setStatus] = useState<'checking' | 'authed'>('checking')
  const setUser = useUserStore((s) => s.setUser)
  const clearUser = useUserStore((s) => s.clearUser)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false

    void getSessionUser().then((user) => {
      if (cancelled) return

      if (user) {
        setUser(user)
        // Resolves after an await inside an effect — intentional, this is
        // the only place the guard learns the session outcome.
        // oxlint-disable-next-line react/set-state-in-effect
        setStatus('authed')
        return
      }

      // A present-but-invalid/expired/revoked token would otherwise sit in
      // storage forever, re-attaching itself as an `Authorization` header on
      // every future request. Only clear it if one was actually present —
      // an already-logged-out visitor has nothing to clear.
      if (getAuthToken()) clearAuthToken()
      // Also clear the store, not just the token — Header reads auth state
      // from the store, not the token. Without this, a session that goes
      // invalid mid-visit (expiry, revocation, sign-out in another tab)
      // leaves Header showing the stale user after this redirect.
      clearUser()
      void navigate({ to: '/login', replace: true })
    })

    return () => {
      cancelled = true
    }
  }, [setUser, clearUser, navigate])

  if (status === 'checking') {
    return (
      <main className="mx-auto flex max-w-md flex-col items-start gap-4 px-4 py-12">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    )
  }

  return <Outlet />
}
