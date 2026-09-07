import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect } from 'react'
import { getSessionUser } from '#/lib/auth-client.ts'
import { useUserStore } from '#/stores/user-store.ts'

// Pathless layout wrapping every authenticated screen.
// The session is an httpOnly cookie now, so this runs during SSR too — the
// incoming request already carries the cookie (forwarded in auth-client.ts).
// Auth is enforced before HTML ships; no client-only pre-check is needed or
// possible (JS can't read an httpOnly cookie).
export const Route = createFileRoute('/_authed')({
  loader: async () => {
    const user = await getSessionUser()
    // getSessionUser() already collapses every failure to null — a null here
    // is a real logout. Do NOT clear the store here: this loader also runs on
    // the server, where the store is process-global and shared across
    // concurrent requests. Client-side state is cleared by Header's logout.
    if (!user) throw redirect({ to: '/login' })
    // getSessionUser() already returns exactly the store's User shape.
    return { user }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const { user } = Route.useLoaderData()
  const setUser = useUserStore((s) => s.setUser)

  // keep the global store in sync so the Header (rendered in __root) sees the user
  useEffect(() => {
    setUser(user)
  }, [user, setUser])

  return <Outlet />
}
