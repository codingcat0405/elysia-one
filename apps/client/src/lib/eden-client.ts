import { treaty } from '@elysia/eden'
import type { App } from 'api'
import { getAuthToken } from './auth-token'

// The session token lives in localStorage (see auth-token.ts), not an
// httpOnly cookie — there is no cookie jar to forward during SSR, and no
// `credentials: 'include'` needed in the browser. Every request attaches
// `Authorization: Bearer <token>` by hand when a token exists; `undefined`
// (no header at all) when it doesn't, including during SSR where
// `getAuthToken()` always returns `null`.
const client = treaty<App>(
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  {
    headers() {
      const token = getAuthToken()
      return token ? { authorization: `Bearer ${token}` } : undefined
    },
  },
)

export const api = client.api

type EdenResult<TData> = {
  data: TData
  error: { status: unknown; value: unknown } | null
  response?: Response
}

// Eden treaty resolves *every* call to `{ data, error, status, ... }` and never
// throws on a non-2xx response. `unwrap` collapses that into "return the body, or
// throw the API error body" so route loaders / form handlers can use plain
// try/catch. Eden nests the response body under `error.value` — for this backend
// that's `{ message, status }`.
export async function unwrap<TData>(
  call: Promise<EdenResult<TData>>,
): Promise<NonNullable<TData>> {
  const { data, error } = await call
  if (error) throw error.value
  if (data == null) throw new Error('Empty response from server')
  return data
}
