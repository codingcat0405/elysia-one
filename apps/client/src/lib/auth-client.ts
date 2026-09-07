import { createAuthClient } from 'better-auth/react'
import { usernameClient } from 'better-auth/client/plugins'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'

// SSR has no cookie jar — forward the incoming request's Cookie header by hand.
// createIsomorphicFn keeps the server-only import out of the client bundle.
const forwardedCookie = createIsomorphicFn()
  .server(() => getRequestHeader('cookie'))
  .client(() => undefined)

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  fetchOptions: { credentials: 'include' },
  plugins: [usernameClient()],
})

export type SessionUser = { id: string; username: string; role: string }

// Same contract as the old `fetchMe()`: collapses every failure (network error,
// no session, API down) to `null` and never throws. Callers decide what "not
// logged in" means for their own route.
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookie = forwardedCookie()
    const { data } = await authClient.getSession({
      fetchOptions: { headers: cookie ? { cookie } : undefined },
    })
    if (!data?.user) return null

    const { user } = data
    return {
      id: user.id,
      // A Google-created account has no `username` — Better Auth's Google
      // mapping only ever sets `name` + `email`. `name` is a required,
      // non-nullable field on Better Auth's core user schema (unlike
      // `email`, which the linter's type-aware check confirms is redundant
      // here), so falling back to it alone is enough to keep the Header from
      // rendering blank for every Google user.
      username: user.username ?? user.name,
      // `role` is a server-only `user.additionalFields` entry (packages/api/src/auth.ts),
      // not surfaced by `usernameClient()`'s `$InferServerPlugin` — the client's
      // generated user type has no `role` key, so a cast is required here even
      // though the value is genuinely present on the wire.
      role: (user as { role?: string }).role ?? 'user',
    }
  } catch {
    return null
  }
}
