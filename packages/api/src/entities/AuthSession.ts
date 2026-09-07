import { Entity, Property, Unique } from '@mikro-orm/core'
import { AuthBaseEntity } from './AuthBaseEntity'

@Entity({ tableName: 'session' })
export class AuthSession extends AuthBaseEntity {
  @Property()
  @Unique()
  token!: string

  @Property()
  expiresAt!: Date

  @Property({ nullable: true })
  ipAddress?: string

  @Property({ nullable: true })
  userAgent?: string

  // Plain scalar, not a `@ManyToOne` relation. The mikro-orm adapter matches
  // Better Auth's camelCase field name against the MikroORM *property* name
  // directly (verified empirically — see phase-01 "Unresolved questions"), so
  // a bare string column is sufficient; no relation mapping is required.
  @Property()
  userId!: string
}
