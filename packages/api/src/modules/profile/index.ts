import { Elysia } from 'elysia'
import authMacro from '../../macros/auth'
import { setup } from '../../middlewares/setup'
import { ProfileModel } from './model'

// Minimal, role-gated demo module replacing the deleted /api/users/{me,admin}.
// Exists to keep the template's headline feature (Eden Treaty + role-gated
// routes) demonstrable after the JWT -> Better Auth migration.
const profileController = new Elysia({ prefix: '/profile' })
  .use(setup)
  .use(authMacro)
  .get('/me', ({ user }) => user, {
    checkAuth: ['user', 'admin'],
    response: { 200: ProfileModel.sessionUser },
    detail: { tags: ['Profile'], security: [{ SessionCookie: [] }] },
  })
  .get('/admin', ({ user }) => user, {
    checkAuth: ['admin'],
    response: { 200: ProfileModel.sessionUser },
    detail: { tags: ['Profile'], security: [{ SessionCookie: [] }] },
  })

export default profileController
