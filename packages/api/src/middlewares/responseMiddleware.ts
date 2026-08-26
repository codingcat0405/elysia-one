import { Utils, wrap } from '@mikro-orm/core'

// Serializes MikroORM entities (single or array) to plain objects so Elysia
// doesn't stringify them as [object Object]. `hidden: true` props (password)
// are stripped by toObject().
// Note: does NOT force set.status, so handlers can return 201 etc.
const responseMiddleware = ({ response }: any) => {
  if (Utils.isEntity(response)) return wrap(response).toObject()
  if (Array.isArray(response) && response.length && Utils.isEntity(response[0]))
    return response.map((e) => wrap(e).toObject())
  return response
}

export default responseMiddleware
