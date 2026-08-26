import { t, type UnwrapSchema } from 'elysia'

export const UserModel = {
  registerBody: t.Object({
    username: t.String({ minLength: 3, maxLength: 64 }),
    password: t.String({ minLength: 8, maxLength: 128 }),
  }),
  loginBody: t.Object({
    username: t.String(),
    password: t.String(),
  }),
  publicUser: t.Object({
    id: t.Numeric(),
    username: t.String(),
    role: t.String(),
  }),
  loginResponse: t.Object({
    user: t.Object({
      id: t.Numeric(),
      username: t.String(),
      role: t.String(),
    }),
    jwt: t.String(),
  }),
} as const

export type UserModel = {
  [k in keyof typeof UserModel]: UnwrapSchema<(typeof UserModel)[k]>
}
