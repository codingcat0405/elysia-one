import { EntityManager, UniqueConstraintViolationException } from '@mikro-orm/postgresql'
import jwt from 'jsonwebtoken'
import { User } from '../../entities/User'
import { ConflictError, UnauthorizedError } from '../../utils/http-errors'
import type { UserModel } from './model'
import { userQueue } from './queue'
import logger from '../../utils/logger'

// cast: @types/jsonwebtoken types expiresIn as ms.StringValue, env vars are plain strings
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ?? '1d') as jwt.SignOptions['expiresIn']

// Precomputed at module load so login() always pays the same bcrypt-verify
// cost whether or not the username exists — closes the timing side-channel.
const DUMMY_HASH = Bun.password.hashSync('dummy-password-for-timing-safety', 'bcrypt')

export class UserService {
  // em is the per-request fork injected by setup.ts.
  // Service lives one request; do NOT make this a singleton (app-lifetime object
  // must never hold a request-lifetime em).
  constructor(private readonly em: EntityManager) { }

  async register({ username, password }: UserModel['registerBody']) {
    const user = this.em.create(User, {
      username,
      password: await Bun.password.hash(password, 'bcrypt'),
      role: 'user',
    })
    try {
      await this.em.flush()
    } catch (e) {
      // rely on the DB unique constraint, not a racy findOne-then-create check
      if (e instanceof UniqueConstraintViolationException)
        throw new ConflictError('User already exists')
      throw e
    }
    // enqueue AFTER flush succeeds — never enqueue a job for a row that
    // might still get rolled back. The user row is already committed at this
    // point, so a queue failure must not surface as a failed registration.
    try {
      await userQueue.add('send-welcome-email', {
        userId: Number(user.id),
        username: user.username,
        type: 'send-welcome-email',
      })
    } catch (e) {
      logger.error(`failed to enqueue send-welcome-email for user ${user.id}`, e)
    }

    return this.toPublic(user)
  }

  async login({ username, password }: UserModel['loginBody']) {
    const user = await this.em.findOne(User, { username })
    // Always run the verify, even for a missing user (against DUMMY_HASH),
    // so lookup+verify cost is the same in both cases -> no timing-based
    // username enumeration. Same error for "no user" and "bad password".
    const passwordOk = await Bun.password.verify(password, user?.password ?? DUMMY_HASH, 'bcrypt')
    if (!user || !passwordOk)
      throw new UnauthorizedError('Invalid username or password')

    const token = jwt.sign(
      { id: Number(user.id), role: user.role },
      process.env.JWT_SECRET!, // presence is asserted at boot in index.ts
      { expiresIn: JWT_EXPIRES_IN },
    )
    return { user: this.toPublic(user), jwt: token }
  }

  async findById(id: number) {
    return this.em.findOne(User, { id })
  }

  private toPublic(user: User): UserModel['publicUser'] {
    return { id: Number(user.id), username: user.username, role: user.role }
  }
}
