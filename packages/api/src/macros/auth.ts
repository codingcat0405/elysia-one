import { Elysia } from 'elysia'
import { RequestContext } from '@mikro-orm/postgresql'
import { ForbiddenError, UnauthorizedError } from '../utils/http-errors'
import { initAuth } from '../auth'
import { initORM } from '../db'

export interface AuthUser {
  id: string
  username: string
  role: string
}

const authMacro = new Elysia({ name: 'macro.auth' }).macro({
  checkAuth(roles: string[]) {
    return {
      resolve: async ({ request }): Promise<{ user: AuthUser }> => {
        const [auth, { orm }] = await Promise.all([initAuth(), initORM()])
        // Better Auth reads the session cookie straight off the real request
        // headers — no cookie schema needed on this macro at all (unlike the
        // old JWT version, which had to work around elysia#1375).
        //
        // `better-auth-mikro-orm@0.5.0` calls `orm.em.*` directly (does not
        // fork itself — see auth.ts / index.ts's `.mount()` comment for the
        // full explanation). `getSession` hits that adapter code too, and
        // this call happens OUTSIDE the mounted handler (this macro runs on
        // plain Eden routes like /api/profile/*, never through `.mount()`),
        // so it needs its own RequestContext wrapper — empirically confirmed:
        // without this, every checkAuth-protected route 500s with MikroORM's
        // "Using global EntityManager instance methods ..." ValidationError.
        const session = await RequestContext.create(orm.em, () =>
          auth.api.getSession({ headers: request.headers }),
        )
        if (!session) throw new UnauthorizedError('Not authenticated')

        // `role` is a Better Auth `user.additionalFields` entry (auth.ts),
        // always present at runtime (`input: false`, `defaultValue: 'user'`).
        // The `?? 'user'` fallback only guards a row from before the field
        // existed — it is never a path to an unknown/elevated privilege.
        const role = session.user.role ?? 'user'
        if (!roles.includes(role)) throw new ForbiddenError()

        return {
          user: {
            id: session.user.id,
            // Google sign-ins never collect a username (see auth.ts's
            // databaseHooks); fall back to email so callers always get a
            // non-empty display string.
            username: session.user.username ?? session.user.email,
            role,
          },
        }
      },
    }
  },
})

export default authMacro
