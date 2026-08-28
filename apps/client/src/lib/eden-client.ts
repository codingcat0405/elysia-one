import { treaty } from '@elysia/eden'
import type { App } from 'api'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeader, setResponseHeader } from '@tanstack/react-start/server'
import { useUserStore } from '#/stores/user-store.ts'

// The access/refresh tokens live in httpOnly cookies now — there is nothing for
// client JS to read or attach. In the browser `credentials: 'include'` is enough;
// during SSR there is no cookie jar at all, so the incoming request's Cookie
// header has to be forwarded by hand. `createIsomorphicFn` is what keeps the
// `@tanstack/react-start/server` import (server-only, throws outside a request)
// out of the client bundle.
const forwardedCookie = createIsomorphicFn()
  .server(() => getRequestHeader('cookie'))
  .client(() => undefined)

const client = treaty<App>(import.meta.env.VITE_API_URL ?? 'http://localhost:3000', {
  fetch: { credentials: 'include' },
  headers() {
    const cookie = forwardedCookie()
    return cookie ? { cookie } : undefined
  },
})

export const api = client.api

type EdenResult<TData> = { data: TData; error: { status: unknown; value: unknown } | null; response?: Response }

// Eden treaty resolves *every* call to `{ data, error, status, ... }` and never
// throws on a non-2xx response. `unwrap` collapses that into "return the body, or
// throw the API error body" so route loaders / form handlers can use plain
// try/catch. Eden nests the response body under `error.value` — for this backend
// that's `{ message, status }`.
export async function unwrap<TData>(call: Promise<EdenResult<TData>>): Promise<NonNullable<TData>> {
  const { data, error } = await call
  if (error) throw error.value
  if (data == null) throw new Error('Empty response from server')
  return data
}

// On the server, forwards the API's rotated Set-Cookie headers on to the
// browser response and returns a Cookie-header string for the immediate retry.
// The browser fetch API hides Set-Cookie from JS entirely (forbidden response
// header) — client-side the browser has already stored the cookies itself, so
// there's nothing to propagate.
const propagateRefreshCookies = createIsomorphicFn()
  .server((response: Response | undefined) => {
    const setCookies = response?.headers.getSetCookie() ?? []
    if (setCookies.length === 0) return undefined
    setResponseHeader('set-cookie', setCookies)
    return setCookies.map((c) => c.split(';')[0]).join('; ')
  })
  .client(() => undefined)

async function doRefresh(): Promise<{ cookie?: string } | null> {
  // Plain unwrap, never unwrapAuthed — refreshing must not itself trigger a refresh.
  const res = await api.users.refresh.post()
  if (res.error) return null
  return { cookie: propagateRefreshCookies(res.response) }
}

// Module scope on the SSR server is process-global, shared across every
// concurrent request — caching one user's in-flight refresh there would hand
// their rotated cookies to whichever other request resolves second. Dedupe is
// therefore client-only; the server always issues its own refresh call.
let refreshInFlight: Promise<{ cookie?: string } | null> | null = null

function refreshOnce(): Promise<{ cookie?: string } | null> {
  if (typeof window === 'undefined') return doRefresh()
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

// For calls that require auth. On a 401, attempts exactly one silent refresh
// and retries the call once; on final failure clears client-side user state
// (never on the server — see refreshOnce) and rethrows the original error.
// Takes a thunk, not a promise, because a retry has to re-issue the call with
// the rotated cookie forwarded (SSR) or nothing extra (browser, already stored).
export async function unwrapAuthed<TData>(
  fn: (headers?: Record<string, string>) => Promise<EdenResult<TData>>,
): Promise<NonNullable<TData>> {
  const r1 = await fn()
  if (r1.error?.status !== 401) return unwrap(Promise.resolve(r1))

  const refreshed = await refreshOnce()
  if (!refreshed) {
    if (typeof window !== 'undefined') useUserStore.getState().clearUser()
    throw r1.error.value
  }

  const r2 = await fn(refreshed.cookie ? { cookie: refreshed.cookie } : undefined)
  return unwrap(Promise.resolve(r2))
}

// Collapses every failure (401, 5xx, network error) to `null` — used by route
// guards, which decide what "not logged in" means for their own route rather
// than branching on error shape. Fails closed on protected routes (redirect to
// /login) and open on public ones (still render the login form if the API is down).
export async function fetchMe() {
  try {
    return await unwrapAuthed((headers) => api.users.me.get({ headers }))
  } catch {
    return null
  }
}
