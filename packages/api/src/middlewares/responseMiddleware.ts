import { Utils, wrap } from '@mikro-orm/core'

// Serializes MikroORM entities (single or array) to plain objects so Elysia
// doesn't stringify them as [object Object]. `hidden: true` props (password)
// are stripped by toObject().
// Note: does NOT force set.status, so handlers can return 201 etc.
//
// The mounted Better Auth handler's response (index.ts's `.mount(...)`) is a
// plain WinterCG `Response`, which also flows through this `onAfterHandle`.
// It's neither an entity nor an array, so the `return response` fallback
// below passes it through byte-for-byte untouched — but only by luck of that
// fallback's shape, not by design. Do NOT "improve" this into unconditionally
// wrapping every response (e.g. `wrap()`-ing or JSON-re-encoding it) — that
// would corrupt Better Auth's Set-Cookie headers and body.
const responseMiddleware = ({ response }: any) => {
  if (Utils.isEntity(response)) return wrap(response).toObject()
  if (Array.isArray(response) && response.length && Utils.isEntity(response[0]))
    return response.map((e) => wrap(e).toObject())
  return response
}

export default responseMiddleware
