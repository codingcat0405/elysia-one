import { treaty } from '@elysia/eden'
import type { App } from 'api'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'

// Better Auth's session cookie is httpOnly — there is nothing for client JS to
// read or attach. In the browser `credentials: 'include'` is enough; during SSR
// there is no cookie jar at all, so the incoming request's Cookie header has to
// be forwarded by hand. `createIsomorphicFn` is what keeps the
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
