import { treaty } from '@elysia/eden'
import type { App } from 'api'
import { ACCESS_TOKEN_KEY } from '../constants'

const server = treaty<App>(import.meta.env.VITE_API_URL ?? 'http://localhost:3000', {
  headers() {
    const token = localStorage.getItem(ACCESS_TOKEN_KEY)
    if (!token) return
    return { authorization: `Bearer ${token}` }
  },
  async onResponse(response) {
    const body = await response.json().catch(() => null)
    if (!response.ok) throw body
    return body
  },
})

export const api = server.api

// `onResponse` above already unwraps to raw data (or throws) at runtime, but
// Eden's generated types are derived purely from each route's response schema
// and know nothing about that transform — they still describe the untouched
// `{ data, error, response, ... }` shape. This corrects the *type* to match
// what the call actually resolves to: `const user = await unwrap(api.users.me.get())`
// `data` is nullable in Eden's original type (paired with a non-null `error`
// on failure) — but onResponse throws on failure instead, so that branch
// never actually resolves; drop the null it'd otherwise carry.
type UnwrapTreaty<T> = T extends { data: infer D } ? Exclude<D, null> : T
export const unwrap = <T extends Promise<{ data: unknown }>>(call: T) =>
  call as unknown as Promise<UnwrapTreaty<Awaited<T>>>
