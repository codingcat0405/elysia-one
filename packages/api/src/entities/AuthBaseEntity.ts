import { type Opt, PrimaryKey, Property } from '@mikro-orm/core'

// Base for the Better Auth core entities (AuthUser/AuthSession/AuthAccount/
// AuthVerification) only. `BaseEntity` cannot be reused: it declares an
// integer `@PrimaryKey`, but Better Auth requires UUID string primary keys
// (see auth.ts's `advanced.database.generateId: false` — MikroORM, via the
// `crypto.randomUUID()` default below, is what actually generates the id).
export abstract class AuthBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string & Opt = crypto.randomUUID()

  @Property()
  createdAt: Date & Opt = new Date()

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date & Opt = new Date()
}
