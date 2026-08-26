import { defineConfig, MemoryCacheAdapter, PostgreSqlDriver } from '@mikro-orm/postgresql'
import RedisCacheAdapter from './utils/RedisCacheAdapter'


export default defineConfig({
  driver: PostgreSqlDriver,
  clientUrl: process.env.DATABASE_URL,
  entities: ['src/entities'],
  pool: {
    // NOTE: in cluster mode total connections = workers * max.
    // Keep workers * max < postgres max_connections (default 100) with headroom.
    min: Number(process.env.DB_POOL_MIN ?? 0),
    max: Number(process.env.DB_POOL_MAX ?? 10),
    // fail fast instead of default 60s hang when the pool is exhausted
    acquireTimeoutMillis: Number(process.env.DB_POOL_ACQUIRE_TIMEOUT_MS ?? 10_000),
    // keep below infra idle timeouts (NAT/LB/firewall) to avoid dead sockets
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? 30_000),
  },
  resultCache: {
    adapter: process.env.REDIS_URL ? RedisCacheAdapter : MemoryCacheAdapter,
    expiration: 1000, // default 1s, override per-query with `cache: [key, ms]`
  }
})
