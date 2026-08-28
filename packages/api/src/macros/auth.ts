import { Elysia } from 'elysia'
import jwt from 'jsonwebtoken'
import { ForbiddenError, UnauthorizedError } from '../utils/http-errors'
import { ACCESS_COOKIE } from '../utils/auth-tokens'

export interface AuthUser {
  id: number
  role: string
}

const authMacro = new Elysia({ name: 'macro.auth' }).macro({
  checkAuth(roles: string[]) {
    return {
      // No `cookie` schema declared here on purpose: a macro that declares both a
      // cookie schema and a resolve() drops cookie type inference (elysia#1375).
      resolve({ cookie }): { user: AuthUser } {
        // Cast: no cookie schema on this macro (elysia#1375 — declaring one here
        // drops cookie type inference entirely), so `.value` isn't typed as string.
        const token = cookie[ACCESS_COOKIE]?.value as string | undefined
        if (!token) throw new UnauthorizedError('Missing access token')

        let decoded: AuthUser
        try {
          decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser
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
