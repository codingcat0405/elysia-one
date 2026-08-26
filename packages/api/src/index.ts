import cluster from 'node:cluster'
import type { Worker } from 'node:cluster'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import process from 'node:process'
import { initORM } from './db'
import logger from './utils/logger'

// type-only: erased at build time, so importing this from `api` never pulls
// in (or runs) the server's runtime code — safe for the frontend to import
export type { App } from './server.js'

// bun-types' `Cluster` type omits the EventEmitter methods it has at runtime
const clusterEvents = cluster as unknown as EventEmitter

let shuttingDown = false
for (const key of ['JWT_SECRET', 'DATABASE_URL']) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`)
  }
}
if(process.env.ENABLE_BULL_BOARD === 'true') {
  if (!process.env.BULL_BOARD_USER || !process.env.BULL_BOARD_PASSWORD) {
    throw new Error('Missing required env var: BULL_BOARD_USER or BULL_BOARD_PASSWORD')
  }
}

const syncSchema = async (closeWhenDone: boolean) => {
  const { orm } = await initORM()
  await orm.schema.updateSchema();
  if (closeWhenDone) {
    await orm.close()
  }
  return orm
}

const logReady = () => {
  logger.info(`🦊 Elysia is running at http://localhost:${process.env.PORT}`)
  if (process.env.ENABLE_SWAGGER === 'true') {
    logger.info(`🦊 Swagger UI: http://localhost:${process.env.PORT}/swagger-ui`)
  }
  if (process.env.ENABLE_BULL_BOARD === 'true') {
    logger.info(`🦊 Bull Board: http://localhost:${process.env.PORT}/bull-board Credentials: ${process.env.BULL_BOARD_USER}:${process.env.BULL_BOARD_PASSWORD}`)
  }
}

const main = async () => {
  const workers = parseInt(process.env.WORKER_THREADS || '1')

  if (workers <= 1) {
    //single mode cached in main thread => don't close the pool
    await syncSchema(false)
    logger.info(
      `Running in single mode. Total database connection pool: ${Number(process.env.DB_POOL_MAX || 10)}`,
    )
    await import('./server.js')
    logReady()

    // single mode: forward signals directly to the server's own shutdown handler
    process.on('SIGTERM', () => process.emit('SIGTERM' as any))
    return
  }

  if (cluster.isPrimary) {
     //cluster mode fork the datasource again in each worker => safe to close this connection in main thread
    await syncSchema(true)

    if (workers > os.availableParallelism()) {
      logger.warn(`WORKERS (${workers}) exceeds available parallelism (${os.availableParallelism()})`)
    }
    logger.info(
      `Starting ${workers} workers. Total database connections: ${Number(process.env.DB_POOL_MAX || 10) * workers}`,
    )

    for (let i = 0; i < workers; i++) cluster.fork()

    // #2: restart crashed workers, but never during a deliberate shutdown
    clusterEvents.on('exit', (worker: Worker, code: number, signal: string) => {
      //IMPORTANT: WITHOUT THIS CHECK, WORKERS WILL RESTART INFINITYLY IF THEY CRASH. AND APP CAN NOT SHUT DOWN.
      if (shuttingDown) return
      logger.warn(`Worker ${worker.process.pid} died (${signal ?? code}), restarting...`)
      cluster.fork()
    })

    // #3: propagate shutdown signals to every worker, exit primary once all are gone
    const shutdown = (signal: NodeJS.Signals) => {
      if (shuttingDown) return
      shuttingDown = true
      logger.info(`${signal} received, stopping ${workers} workers...`)

      const ids = Object.keys(cluster.workers ?? {})
      if (ids.length === 0) {
        process.exit(0)
        return
      }
      for (const id of ids) cluster.workers?.[id]?.kill(signal)

      clusterEvents.on('exit', () => {
        if (Object.keys(cluster.workers ?? {}).length === 0) {
          logger.info('All workers stopped, exiting primary')
          process.exit(0)
        }
      })

      // safety net: force-exit if workers hang past their own shutdown timeout
      setTimeout(() => {
        logger.warn('Workers did not exit in time, forcing shutdown')
        process.exit(1)
      }, 15_000).unref()
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))

    // log readiness once workers have actually come online, not just been spawned
    let onlineCount = 0
    clusterEvents.on('online', (worker: Worker) => {
      onlineCount++
      logger.info(`Worker ${worker.process.pid} online (${onlineCount}/${workers})`)
      if (onlineCount === workers) logReady()
    })
  } else {
    await import('./server.js')
    logger.info(`Worker ${process.pid} started`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})