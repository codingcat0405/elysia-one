import { Elysia } from 'elysia'
import authMacro from '../../macros/auth'
import { NotFoundError, UnauthorizedError } from '../../utils/http-errors'
import { UserModel } from './model'
import { setup } from '../../middlewares/setup'
import { clearAuthCookies, setAuthCookies, signTokenPair, verifyRefreshToken, REFRESH_COOKIE } from '../../utils/auth-tokens'
import logger from '../../utils/logger'

const userController = new Elysia({ prefix: '/users' })
  .use(authMacro)
  .use(setup)
  .post(
    '/register',
    ({ body, userService }) => userService.register(body),
    {
      body: UserModel.registerBody,
      response: { 200: UserModel.publicUser },
      detail: { tags: ['User'] },
    },
  )
  .post(
    '/login',
    async ({ body, cookie, userService }) => {
      const user = await userService.login(body)
      setAuthCookies(cookie, signTokenPair(user))
      return { user }
    },
    {
      body: UserModel.loginBody,
      response: { 200: UserModel.loginResponse },
      detail: { tags: ['User'] },
    },
  )
  .post(
    '/refresh',
    // No checkAuth: the access token is expired by definition when this is called.
    async ({ cookie, userService }) => {
      try {
        // Cast: no cookie schema on this route (elysia#1375), so `.value` isn't typed as string.
        const refreshToken = cookie[REFRESH_COOKIE]?.value as string | undefined
        if (!refreshToken) throw new UnauthorizedError('Missing refresh token')

        const { id } = verifyRefreshToken(refreshToken)
        const found = await userService.findById(id)
        if (!found) throw new UnauthorizedError('User no longer exists')

        // Sign from the DB row, not the refresh token's claims, so a role
        // change or account deletion takes effect on the very next refresh —
        // this DB read is the only revocation lever with no token table.
        const user = { id: Number(found.id), username: found.username, role: found.role }
        setAuthCookies(cookie, signTokenPair(user))
        return { user }
      } catch (e) {
        clearAuthCookies(cookie)
        // A DB blip on findById looks identical to a forged/expired token here —
        // log the non-auth case so it's distinguishable from an actual bad
        // token when someone's 30-day session mysteriously dies.
        if (!(e instanceof UnauthorizedError)) logger.error('refresh failed unexpectedly', e)
        throw e instanceof UnauthorizedError ? e : new UnauthorizedError('Invalid or expired refresh token')
      }
    },
    {
      response: { 200: UserModel.loginResponse },
      detail: { tags: ['User'] },
    },
  )
  .post(
    '/logout',
    // Intentionally unauthenticated: must clear cookies even with an expired access token.
    ({ cookie }) => {
      clearAuthCookies(cookie)
      return { success: true }
    },
    {
      response: { 200: UserModel.logoutResponse },
      detail: { tags: ['User'] },
    },
  )
  .get(
    '/me',
    async ({ user, userService }) => {
      const found = await userService.findById(user.id)
      if (!found) throw new NotFoundError('User not found')
      return found // entity -> responseMiddleware serializes, password hidden
    },
    {
      checkAuth: ['user', 'admin'],
      detail: { tags: ['User'], security: [{ JwtAuth: [] }] },
    },
  )
  .get(
    '/admin',
    ({ user }) => user,
    {
      checkAuth: ['admin'],
      detail: { tags: ['User'], security: [{ JwtAuth: [] }] },
    },
  )

export default userController
