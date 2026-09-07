import { Entity, Index, Property } from '@mikro-orm/core'
import { AuthBaseEntity } from './AuthBaseEntity'

// SECURITY: this entity holds the scrypt credential hash and OAuth bearer
// tokens (below). It intentionally has NO `hidden: true` on those fields —
// see the comment on `password` for why — so the ONLY thing preventing them
// from leaking over HTTP is that no route anywhere returns an `AuthAccount`
// entity (`modules/profile` builds a plain `{ id, username, role }` object
// instead). If you add a route, an admin user-list, a debug endpoint, or an
// ORM `populate` that puts an `AuthAccount` (or one of its sensitive fields)
// into a response, you have reopened this hole. Grep for `AuthAccount` before
// trusting any new response shape.
@Entity({ tableName: 'account' })
export class AuthAccount extends AuthBaseEntity {
  @Property()
  accountId!: string

  @Property()
  providerId!: string

  // Plain scalar (see AuthSession.userId comment) — no `@ManyToOne` relation.
  // Indexed: Better Auth looks up a user's linked accounts (credential +
  // OAuth) by this column on sign-in, account-linking, and session checks.
  @Index()
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
