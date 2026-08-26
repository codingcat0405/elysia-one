import { Elysia } from 'elysia'
import jwt from 'jsonwebtoken'
import { ForbiddenError, UnauthorizedError } from '../utils/http-errors'

export interface AuthUser {
  id: number
  role: string
}

const authMacro = new Elysia({ name: 'macro.auth' }).macro({
  checkAuth(roles: string[]) {
    return {
      resolve({ headers }): { user: AuthUser } {
        const header = headers.authorization
        if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Missing bearer token')

        let decoded: AuthUser
        try {
          decoded = jwt.verify(header.slice('Bearer '.length), process.env.JWT_SECRET!) as AuthUser
        } catch {
          // expired / malformed / bad signature -> 401, never a 500
          throw new UnauthorizedError('Invalid or expired token')
        }

        if (!roles.includes(decoded.role)) throw new ForbiddenError()
        return { user: { id: decoded.id, role: decoded.role } }
      },
    }
  },
})

export default authMacro
