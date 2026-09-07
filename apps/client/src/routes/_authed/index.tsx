import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api, unwrap } from '#/lib/eden-client.ts'

const authedRoute = getRouteApi('/_authed')

export const Route = createFileRoute('/_authed/')({
  component: HomePage,
})

function HomePage() {
  // read straight from the layout loader — no store round-trip, no stale first frame
  const { user } = authedRoute.useLoaderData()
  // 'checking' avoids flashing "no" before the request resolves.
  const [adminAccess, setAdminAccess] = useState<'checking' | 'yes' | 'no'>(
    'checking',
  )

  useEffect(() => {
    let cancelled = false
    // Exercises the Eden-typed `/api/profile/admin` role gate. `role` is
    // display-only client state — this trusts the server's 200/403, not
    // `user.role`, as the actual authorization decision.
    unwrap(api.profile.admin.get())
      .then(() => {
        if (!cancelled) setAdminAccess('yes')
      })
      .catch(() => {
        // A 403 (not an admin) and any other failure both render as "no" —
        // there is nothing actionable to show a non-admin user here.
        if (!cancelled) setAdminAccess('no')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="mx-auto flex max-w-md flex-col items-start gap-4 px-4 py-12">
      <h1 className="text-xl font-semibold">Home</h1>
      <p className="text-sm text-muted-foreground">
        Logged as ID: {user.id}, username: {user.username}
      </p>
      <p className="text-sm text-muted-foreground">
        admin access: {adminAccess === 'checking' ? '…' : adminAccess}
      </p>
    </main>
  )
}
