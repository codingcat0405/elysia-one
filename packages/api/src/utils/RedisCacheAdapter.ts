// src/utils/RedisCacheAdapter.ts
import type { CacheAdapter } from '@mikro-orm/core'
import { getRedis } from './redis'

const DEFAULT_TTL_MS = 1000 
const PREFIX = 'mikro:cache:'
class RedisCacheAdapter implements CacheAdapter {


  private key(name: string) {
    return `${PREFIX}${name}`
  }

  async get(name: string): Promise<any> {
    const redis = await getRedis()
    const raw = await redis.get(this.key(name))
    if (raw == null) return undefined
    try {
      const { data } = JSON.parse(raw)
      return data // ✅ return only the original cached value
    } catch {
      return undefined
    }
  }

  async set(name: string, data: any, origin: string, expiration?: number): Promise<void> {
    const redis = await getRedis()
    const payload = JSON.stringify({ data, origin })
    const ttl = expiration && expiration > 0 ? expiration : DEFAULT_TTL_MS
    await redis.set(this.key(name), payload, 'PX', ttl)
  }

  async remove(name: string): Promise<void> {
    const redis = await getRedis()
    await redis.del(this.key(name))
  }

  async clear(): Promise<void> {
    const redis = await getRedis()
    // SCAN instead of KEYS: non-blocking, safe on a shared/production Redis
    let cursor = '0'
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${PREFIX}*`, 'COUNT', 100)
      cursor = next
      if (keys.length) await redis.del(...keys)
    } while (cursor !== '0')
  }

  async close(): Promise<void> {
    // intentionally a no-op: `redisClient` in utils/redis.ts is a shared
    // process-wide client (sessions, rate limiting, etc). MikroORM calls
    // this inside orm.close() — quitting here would kill Redis for the
    // whole app, not just the ORM cache. If you want the adapter to own
    // its lifecycle, give it a DEDICATED client instead of the shared one.
  }
}

export default RedisCacheAdapter;