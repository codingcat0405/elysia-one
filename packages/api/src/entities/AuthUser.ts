import { type Opt, Entity, Property, Unique } from '@mikro-orm/core'
import { AuthBaseEntity } from './AuthBaseEntity'

// `tableName: 'user'` collides with the Postgres reserved word `user`.
// MikroORM quotes identifiers ("user"), so this is safe — but any future raw
// SQL against this table must quote it too.
@Entity({ tableName: 'user' })
export class AuthUser extends AuthBaseEntity {
  @Property()
  name!: string

  @Property()
  @Unique()
  email!: string

  @Property()
  emailVerified: boolean & Opt = false

  @Property({ nullable: true })
  image?: string

  // `username` plugin fields — Better Auth adds these two columns to `user`
  // directly, no separate table/schema (verified via getAuthTables()).
  @Property({ nullable: true })
  @Unique()
  username?: string

  @Property({ nullable: true })
  displayUsername?: string

  // Better Auth `user.additionalFields.role` (see auth.ts). Nullable at the DB
  // level and defaulted by Better Auth config (`defaultValue: 'user'`) —
  // never by user input. `input: false` in auth.ts is the actual
  // privilege-escalation defence; this column must never be writable from a
  // request body.
  @Property({ nullable: true })
  role?: string
}
