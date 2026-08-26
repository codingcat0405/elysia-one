import { Elysia } from 'elysia'
import authMacro from '../../macros/auth'
import { NotFoundError } from '../../utils/http-errors'
import { UserModel } from './model'
import { setup } from '../../middlewares/setup'

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
    ({ body, userService }) => userService.login(body),
    {
      body: UserModel.loginBody,
      response: { 200: UserModel.loginResponse },
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
