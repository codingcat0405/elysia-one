import type { Job } from 'bullmq'
import type { MikroORM } from '@mikro-orm/postgresql'
import { User } from '../../entities/User'
import logger from '../../utils/logger'
import { UserJob } from './queue'

// One em.fork() per job — same discipline as one em.fork() per HTTP request.
// Never reuse orm.em (global) directly, and never share one fork across jobs.
export function createUserJobProcessor(orm: MikroORM) {
  return async (job: Job<UserJob>) => {
    const em = orm.em.fork()

    switch (job.name) {
      case 'send-welcome-email': {
        const user = await em.findOne(User, { id: job.data.userId })
        if (!user) {
          // don't retry forever for a user that no longer exists
          logger.warn(`send-welcome-email: user ${job.data.userId} not found, skipping`)
          return
        }
        // TODO: plug in real email provider
        logger.info(`Sending welcome email to ${user.username}`)
        return
      }
      default:
        throw new Error(`Unknown job name: ${job.name}`)
    }
  }
}
