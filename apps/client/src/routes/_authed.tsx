import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect } from 'react'
import { fetchMe } from '#/lib/eden-client.ts'
import { useUserStore } from '#/stores/user-store.ts'

// Pathless layout wrapping every authenticated screen.
// The token is an httpOnly cookie now, so this runs during SSR too — the
// incoming request already carries the cookie (forwarded in eden-client.ts).
// Auth is enforced before HTML ships; no client-only pre-check is needed or
// possible (JS can't read an httpOnly cookie).
export const Route = createFileRoute('/_authed')({
  loader: async () => {
    const user = await fetchMe()
    // fetchMe() already tried one silent refresh — a null here is a real
    // logout. Do NOT clear the store here: this loader also runs on the
    // server, where the store is process-global and shared across concurrent
    // requests. Client-side state is cleared by unwrapAuthed / Header's logout.
    if (!user) throw redirect({ to: '/login' })
    // narrow to the store's User shape — /users/me has no response schema, so
    // Eden's inferred type is the full entity, not just {id, username, role}
    return { user: { id: user.id, username: user.username, role: user.role } }
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
