import { t, type UnwrapSchema } from 'elysia'

const sessionUser = t.Object({
  id: t.String(),
  username: t.String(),
  role: t.String(),
})

export const ProfileModel = {
  sessionUser,
} as const

export type ProfileModel = {
  [k in keyof typeof ProfileModel]: UnwrapSchema<(typeof ProfileModel)[k]>
}
