import { betterAuth } from 'better-auth'
import { username } from 'better-auth/plugins'
import { mikroOrmAdapter } from 'better-auth-mikro-orm'
import type { MikroORM } from '@mikro-orm/postgresql'
import { initORM } from './db'
import { userQueue } from './modules/user/queue'
import logger from './utils/logger'
import { getClientOrigins } from './utils/client-origins'

// Shape actually observed from the installed better-auth@1.7.3 at runtime
// (verified empirically during the Phase 01 adapter spike) — kept minimal on
// purpose, see the `Auth` type comment below for why this can't just be
// `ReturnType<typeof createAuth>`.
interface AuthUserShape {
  id: string
  email: string
  name: string
  emailVerified: boolean
  image?: string | null
  username?: string | null
  displayUsername?: string | null
  role?: string | null
  createdAt: Date
  updatedAt: Date
}

// Minimal shape of what `auth.api.getSession` returns for `session` — only
// the fields macros/auth.ts might plausibly need; extend on demand like AuthApi.
interface AuthSessionShape {
  id: string
  token: string
  userId: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
  ipAddress?: string | null
  userAgent?: string | null
}

interface AuthApi {
  signUpEmail(input: {
    body: {
      email: string
      password: string
      name: string
      username?: string
      displayUsername?: string
      callbackURL?: string
    }
  }): Promise<{ token: string | null; user: AuthUserShape }>
  signInUsername(input: {
    body: { username: string; password: string; rememberMe?: boolean }
  }): Promise<{
    redirect: boolean
    token: string
    url?: string | null
    user: AuthUserShape
  }>
  // Added in Phase 02 for macros/auth.ts's session resolve. `headers` must be
  // the real WinterCG `Headers` from the incoming request (carries the
  // `better-auth.session_token` cookie) — a plain object will not work.
  getSession(input: {
    headers: Headers
  }): Promise<{ session: AuthSessionShape; user: AuthUserShape } | null>
}

// Shared with index.ts's CORS config (must agree with it: this feeds Better
// Auth's own Origin/Referer check on state-changing requests, the second
// half of the Lax-cookie CSRF defence now that SameSite=Strict is gone).
const clientOrigins = getClientOrigins()

// Google is opt-in: registered only when BOTH vars are present. index.ts's
// boot check fails fast on exactly one being set; this is just the
// both-present gate for actually building the socialProviders block. A
// template that refuses to boot without Google Cloud Console credentials is
// broken for the 90% case that never configures Google.
const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          scope: ['openid', 'email', 'profile'],
        },
      }
    : undefined

// betterAuth() needs a live MikroORM instance, which only exists after
// `await initORM()`. Solved with a memoized async factory mirroring db.ts's
// initORM, not top-level `await` — worker.ts imports the same module graph
// and must not open an auth-side connection as an import side effect.
const createAuth = (orm: MikroORM) =>
  betterAuth({
    database: mikroOrmAdapter(orm),
    advanced: { database: { generateId: false } },
    // Boot-required (index.ts's env loop) — Better Auth signs/verifies
    // session tokens and CSRF state with this.
    secret: process.env.BETTER_AUTH_SECRET,
    // Public origin of THIS api, used for OAuth callback construction.
    baseURL:
      process.env.BETTER_AUTH_URL ??
      `http://localhost:${process.env.PORT ?? 3000}`,
    trustedOrigins: clientOrigins,
    // Do NOT set advanced.defaultCookieAttributes.sameSite — the default is
    // already 'lax' (plan.md D5); an explicit override is one more thing to
    // drift from upstream's default.
    emailAndPassword: { enabled: true },
    // `allowUsernameOrEmail` does not exist on the installed better-auth@1.7.3
    // `UsernameOptions` type (confirmed via `bun run check-types` + reading
    // the installed plugin source: `signInUsername` looks up strictly by the
    // `username` field, there is no email fallback in this version). The
    // phase-01 plan's step-5 snippet inherited this from a skill/research
    // doc that doesn't match the resolved version — dropped here.
    plugins: [username()],
    ...(google && { socialProviders: google }),
    // Renamed off Better Auth's defaults ('user'/'session'/'account'/
    // 'verification'). better-auth-mikro-orm resolves a MikroORM entity class
    // from the model name via `naming.getEntityName(naming.classToTableName(model))`
    // — with the default model name 'user' that resolves to the class name
    // `User`, which collided with a legacy integer-PK entity of the same
    // class name (deleted in Phase 02) that used to be registered in this
    // same MikroORM instance via `entities: ['src/entities']`. Renaming the
    // model to 'authUser' makes it resolve to `AuthUser` instead — verified
    // empirically, see phase-01 "Unresolved questions" §1/§4. Kept even
    // though the legacy entity is now gone (Phase 02) — reverting would be
    // needless churn now that the rest of the codebase (entities, this file's
    // comments) already assumes the renamed model names. The physical table
    // names stay `user`/`session`/`account`/`verification` via each entity's
    // own `@Entity({ tableName })`.
    user: {
      modelName: 'authUser',
      // `role` MUST stay `input: false` — without it, `signUp`'s body and
      // Google OAuth profile mapping could both set `role: 'admin'`. This is
      // the single highest-severity item in the migration.
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'user',
          input: false,
        },
      },
    },
    session: { modelName: 'authSession' },
    account: { modelName: 'authAccount' },
    verification: { modelName: 'authVerification' },
    databaseHooks: {
      user: {
        create: {
          // Fires after the row is committed (Better Auth's own guarantee),
          // same ordering as the old registration flow — enqueue AFTER
          // the write succeeds, never before. Fires for Google-created users
          // too: a Google signup IS a new user, that's correct behaviour,
          // not a bug (see plan.md risk table) — do not special-case it out.
          after: async (user) => {
            try {
              await userQueue.add('send-welcome-email', {
                type: 'send-welcome-email',
                userId: user.id,
                // Google sign-ins never collect a username; fall back to
                // email so the queue payload always has a display string.
                username:
                  (user as { username?: string | null }).username ?? user.email,
              })
            } catch (e) {
              // Swallow-and-log: a Redis outage must never turn a successful
              // signup into a failed one.
              logger.error(
                `failed to enqueue send-welcome-email for user ${user.id}`,
                e,
              )
            }
          },
        },
      },
    },
  })

// `export type Auth = ReturnType<typeof createAuth>` (as the phase-01 plan
// originally specified) fails `bun run check-types` with:
//   TS2883: The inferred type of 'createAuth' cannot be named without a
//   reference to '$strip' from '.../zod/v4/core'. This is likely not portable.
// Confirmed to be a better-auth/zod-v4 upstream limitation, NOT something
// fixable in this file: reproduces with the bare `username()` plugin and zero
// extra config (tested in isolation), is unaffected by bumping TypeScript
// 6.0.3 -> 7.0.2 (tested), and only disappears if `tsconfig.json`'s
// `declaration`/`emitDeclarationOnly` are turned off (out of scope to change
// — see AGENTS.md §12, `dist/index.d.ts` is apps/client's contract). This is
// a long-standing open issue upstream (multiple better-auth GitHub issues,
// e.g. #4654, #1861, #6909) with no first-party fix as of better-auth 1.7.3.
//
// Workaround: assert the real (fully-featured) runtime instance through a
// hand-written interface covering exactly what's exercised so far. Phase 02
// extended `AuthApi` with `getSession` and added `handler` here (the WinterCG
// fetch handler `.mount()`/`index.ts` calls per request) — do not attempt
// `ReturnType<typeof createAuth>` again without first re-checking whether
// upstream has fixed the underlying zod-v4 declaration-emit bug (see the
// TS2883 note above). `handler` is typed here (not on `AuthApi`) because it's
// a property of the auth instance itself, not of `auth.api`.
export type Auth = {
  api: AuthApi
  handler: (request: Request) => Promise<Response>
}

let instance: Promise<Auth> | null = null

// Cached initializer: safe to call multiple times, initializes once. Caches
// the in-flight PROMISE, not the resolved value — the previous version
// awaited `initORM()` before the `??=` assignment ran, so two concurrent
// first callers could both see `instance` as unset and each build (and
// discard) their own betterAuth() instance. Assigning the promise
// synchronously, before any internal `await` runs, closes that window: the
// second caller's `??=` check now always sees the first caller's in-flight
// promise and awaits the same one. Not reachable today (main() awaits this
// once, serially, before .listen()) — fixed anyway since it's a one-line
// change and a latent footgun for any future concurrent boot-time caller.
export const initAuth = (): Promise<Auth> =>
  (instance ??= (async () =>
    createAuth((await initORM()).orm) as unknown as Auth)())
