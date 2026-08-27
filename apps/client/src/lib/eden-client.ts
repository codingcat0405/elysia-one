import { treaty } from '@elysia/eden'
import type { App } from 'api'
import { getToken } from './auth'

const client = treaty<App>(
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  {
    headers() {
      const token = getToken()
      return token ? { authorization: `Bearer ${token}` } : undefined
    },
  },
)

export const api = client.api

// Eden treaty resolves *every* call to `{ data, error, status, ... }` and never
// throws on a non-2xx response. `unwrap` collapses that into "return the body, or
// throw the API error body" so route loaders / form handlers can use plain
// try/catch. Eden nests the response body under `error.value` — for this backend
// that's `{ message, status }`.
export async function unwrap<TData>(
  call: Promise<{ data: TData; error: { value: unknown } | null }>,
): Promise<NonNullable<TData>> {
  const { data, error } = await call
  if (error) throw error.value
  if (data == null) throw new Error('Empty response from server')
  return data
}
