import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect } from 'react'
import { clearToken, getToken } from '#/lib/auth.ts'
import { api, unwrap } from '#/lib/eden-client.ts'
import { useUserStore } from '#/stores/user-store.ts'

// Pathless layout wrapping every authenticated screen.
// `ssr: false` so the localStorage token check + /users/me fetch run in the browser.
export const Route = createFileRoute('/_authed')({
  ssr: false,
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: '/login' })
  },
  loader: async () => {
    try {
      const me = await unwrap(api.users.me.get())
      return { user: { id: me.id, username: me.username, role: me.role } }
    } catch {
      // expired / invalid / revoked token — drop it, wipe identity, bounce to login
      clearToken()
      useUserStore.getState().clearUser()
      throw redirect({ to: '/login' })
    }
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
