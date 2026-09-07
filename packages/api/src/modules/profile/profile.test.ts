// Route-level tests via Elysia's own unit-test pattern (app.handle() against
// a real Request/Response, https://elysiajs.com/patterns/unit-test) driven
// against this project's REAL Postgres + Redis — there is no mocked/in-memory
// mode, matching how the rest of the app already requires real infra to boot
// (see AGENTS.md, README's "Known gaps"). Requires packages/api/.env filled
// in and Postgres/Redis reachable; skip locally with `bun test --test-name-pattern`
// if you don't have them running.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { main } from '../../index'
import { initORM } from '../../db'

let app: Awaited<ReturnType<typeof main>>

beforeAll(async () => {
  // Set before calling main(), so app.listen() binds a test-only port
  // instead of colliding with a real `bun dev`/`bun start` listening on the
  // .env-configured PORT (default 3000). Safe to set here (not at module
  // top-level, before any import runs): main() only reads process.env.PORT
  // inside its own body, when actually called — never at import time.
  process.env.PORT = '3999'
  app = await main()
})

async function truncateAuthTables() {
  const { orm } = await initORM()
  await orm.em.getConnection().execute('TRUNCATE "account","session","user","verification" CASCADE')
}

async function signUp(overrides: Record<string, unknown> = {}) {
  return app.handle(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'password123',
        username: 'alice',
        name: 'alice',
        ...overrides,
      }),
    }),
  )
}

function sessionCookie(res: Response): string {
  const raw = res.headers.get('set-cookie')
  if (!raw) throw new Error('sign-up response had no Set-Cookie header')
  return raw.split(';')[0] // strip attributes, keep `name=value`
}

describe('profile routes (real Postgres + Redis)', () => {
  beforeEach(truncateAuthTables)
  afterAll(truncateAuthTables)

  it('GET /api/profile/me without a cookie is 401', async () => {
    const res = await app.handle(new Request('http://localhost/api/profile/me'))
    expect(res.status).toBe(401)
  })

  it('GET /api/profile/me with a valid session returns the user', async () => {
    const signupRes = await signUp()
    expect(signupRes.status).toBe(200)
    const cookie = sessionCookie(signupRes)

    const res = await app.handle(new Request('http://localhost/api/profile/me', { headers: { cookie } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: expect.any(String), username: 'alice', role: 'user' })
  })

  it('GET /api/profile/admin is 403 for a plain user', async () => {
    const signupRes = await signUp()
    const cookie = sessionCookie(signupRes)

    const res = await app.handle(new Request('http://localhost/api/profile/admin', { headers: { cookie } }))
    expect(res.status).toBe(403)
  })

  it('blocks privilege escalation: role in the sign-up body is ignored', async () => {
    // The single highest-severity invariant in this codebase (auth.ts's
    // `role: { input: false }`) — this test is the automated version of the
    // manual curl+psql check run during the Better Auth migration.
    const signupRes = await signUp({ email: 'eve@example.com', username: 'eve', role: 'admin' })
    expect(signupRes.status).toBe(200)
    const body = await signupRes.json()
    expect(body.user.role).toBe('user')

    // Also verify via the actual authorization path, not just the response body.
    const cookie = sessionCookie(signupRes)
    const res = await app.handle(new Request('http://localhost/api/profile/admin', { headers: { cookie } }))
    expect(res.status).toBe(403)
  })

  it('rejects sign-in with the wrong password', async () => {
    await signUp()
    const res = await app.handle(
      new Request('http://localhost/api/auth/sign-in/username', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'wrong-password' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects a duplicate email on sign-up', async () => {
    await signUp()
    const res = await signUp({ username: 'someone-else' })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})
