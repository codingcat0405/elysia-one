import { t, type UnwrapSchema } from 'elysia'

const publicUser = t.Object({
  id: t.Numeric(),
  username: t.String(),
  role: t.String(),
})

export const UserModel = {
  registerBody: t.Object({
    username: t.String({ minLength: 3, maxLength: 64 }),
    password: t.String({ minLength: 8, maxLength: 128 }),
  }),
  loginBody: t.Object({
    username: t.String(),
    password: t.String(),
  }),
  publicUser,
  // Token pair now travels as httpOnly cookies, not in the response body.
  loginResponse: t.Object({ user: publicUser }),
  logoutResponse: t.Object({ success: t.Boolean() }),
} as const

export type UserModel = {
  [k in keyof typeof UserModel]: UnwrapSchema<(typeof UserModel)[k]>
}
