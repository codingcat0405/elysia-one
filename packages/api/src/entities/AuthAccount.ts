import { Entity, Property } from '@mikro-orm/core'
import { AuthBaseEntity } from './AuthBaseEntity'

@Entity({ tableName: 'account' })
export class AuthAccount extends AuthBaseEntity {
  @Property()
  accountId!: string

  @Property()
  providerId!: string

  // Plain scalar (see AuthSession.userId comment) — no `@ManyToOne` relation.
  @Property()
  userId!: string

  // OAuth bearer credentials for a third party. NOT marked `hidden: true`:
  // verified empirically that better-auth-mikro-orm's `normalizeOutput` uses
  // MikroORM's `serialize()` for every adapter read (not just HTTP response
  // serialization), and `serialize()` drops `hidden: true` fields — so a
  // hidden `password` field came back as `undefined` from the adapter's own
  // internal `findOne` during sign-in, breaking credential verification
  // ("Password not found" / always-invalid-password). The same would happen
  // to `accessToken`/`refreshToken`/`idToken` on Better Auth's internal OAuth
  // token-refresh reads. Defense against leaking these to HTTP responses
  // must instead be "never return an AuthAccount entity from a route" (true
  // today, no route does) — do not add `hidden: true` back here.
  @Property({ nullable: true })
  accessToken?: string

  @Property({ nullable: true })
  refreshToken?: string

  @Property({ nullable: true })
  idToken?: string

  @Property({ nullable: true })
  accessTokenExpiresAt?: Date

  @Property({ nullable: true })
  refreshTokenExpiresAt?: Date

  @Property({ nullable: true })
  scope?: string

  // Scrypt hash of the credential-provider password. Same `hidden: true`
  // incompatibility as above — see comment on accessToken.
  @Property({ nullable: true })
  password?: string
}
