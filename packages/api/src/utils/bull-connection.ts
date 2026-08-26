import { Redis } from 'ioredis'

// BullMQ needs its own dedicated connection(s) — it issues blocking commands
// (BRPOPLPUSH etc.) internally. Reusing the shared `getRedis()` client from
// utils/redis.ts (used for the MikroORM cache adapter + RedisLock) would
// conflict with those blocking calls. Safe to point at the same Redis
// server, just must be a separate client instance.
//
// `maxRetriesPerRequest: null` is required by BullMQ workers — without it,
// ioredis gives up retrying blocking commands and BullMQ throws at startup.
export const bullConnection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
})
