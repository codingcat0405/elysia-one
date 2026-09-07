import { Entity, Property } from '@mikro-orm/core'
import { AuthBaseEntity } from './AuthBaseEntity'

@Entity({ tableName: 'verification' })
export class AuthVerification extends AuthBaseEntity {
  @Property()
  identifier!: string

  @Property()
  value!: string

  @Property()
  expiresAt!: Date
}
