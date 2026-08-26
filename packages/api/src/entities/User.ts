import { Entity, Property, Unique } from '@mikro-orm/core'
import { BaseEntity } from './BaseEntity'

@Entity()
export class User extends BaseEntity {
  @Property()
  @Unique() // DB-level constraint: the findOne-then-create check alone is a race condition
  username!: string

  // hidden: excluded from wrap(entity).toObject() / serialization -> never leaks to clients
  @Property({ hidden: true })
  password!: string

  @Property()
  role!: string
}
