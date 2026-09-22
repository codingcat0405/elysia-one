import { createAuthClient } from 'better-auth/react'
import { usernameClient } from 'better-auth/client/plugins'
import { getAuthToken, setAuthToken, clearAuthToken } from './auth-token'

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  fetchOptions: {
    auth: { type: 'Bearer', token: () => getAuthToken() ?? '' },
    // Only sign-in/sign-up responses carry `set-auth-token` (exposed via CORS
    // in packages/api/src/auth.ts) — this fires for every authClient call, so
    // a single guard here covers both. No call site may pass its own
    // `fetchOptions.onSuccess`: better-auth lets a per-call one override this
    // global one, silently dropping the token capture.
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get('set-auth-token')
      if (token) setAuthToken(token)
    },
  },
  plugins: [usernameClient()],
})

export type SessionUser = { id: string; username: string; role: string }

// Same contract as the old `fetchMe()`: collapses every failure (network error,
// no session, API down) to `null` and never throws. Callers decide what "not
// logged in" means for their own route.
export async function getSessionUser(): Promise<SessionUser | null> {
  // No token → logged out (or SSR, where localStorage doesn't exist) —
  // short-circuits before firing a request that could never succeed.
  if (!getAuthToken()) return null
  try {
    const { data } = await authClient.getSession()
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

// A server-side session delete doesn't remove the client's localStorage
// copy — clear it explicitly, even when the network call fails, so a stale
// token never keeps attaching itself to requests after sign-out.
export async function signOut(): Promise<void> {
  try {
    await authClient.signOut()
  } finally {
    clearAuthToken()
  }
}
