import { Worker } from 'bullmq'
import { initORM } from './db'
import logger from './utils/logger'
import { USER_QUEUE_NAME } from './modules/user/queue'
import { createUserJobProcessor } from './modules/user/worker'
import { bullConnection } from './utils/bull-connection'

for (const key of ['JWT_SECRET', 'DATABASE_URL', 'REDIS_URL']) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`)
}

const main = async () => {
  const { orm } = await initORM()

  // register one Worker per queue here as the app grows, e.g.:
  // const orderWorker = new Worker(ORDER_QUEUE_NAME, createOrderJobProcessor(orm), {...})
  const workers = [
    new Worker(USER_QUEUE_NAME, createUserJobProcessor(orm), {
      connection: bullConnection,
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
    }),
  ]

  for (const w of workers) {
    w.on('completed', (job) => logger.info(`[${w.name}] job ${job.id} completed`))
    w.on('failed', (job, err) =>
      logger.error(`[${w.name}] job ${job?.id} failed: ${err.message}`),
    )
    w.on('error', (err) => logger.error(`[${w.name}] worker error`, err))
  }

  logger.info(`Worker process started, consuming: ${workers.map((w) => w.name).join(', ')}`)

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, closing workers...`)
    // waits for active jobs to finish, stops picking up new ones
    await Promise.all(workers.map((w) => w.close()))
    await orm.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
