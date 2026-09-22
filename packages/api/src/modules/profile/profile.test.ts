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
  await orm.em
    .getConnection()
    .execute('TRUNCATE "account","session","user","verification" CASCADE')
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

// Extract the bearer token from the response header. Throws clearly if missing
// so test failures point to the real issue (missing header) not a confusing 401.
function authToken(res: Response): string {
  const token = res.headers.get('set-auth-token')
  if (!token) throw new Error('response had no set-auth-token header')
  return token
}

// Helper for bearer auth headers (replaces the cookie-based flow).
function bearer(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('profile routes (real Postgres + Redis)', () => {
  beforeEach(truncateAuthTables)
  afterAll(truncateAuthTables)

  it('GET /api/profile/me without auth header is 401', async () => {
    const res = await app.handle(new Request('http://localhost/api/profile/me'))
    expect(res.status).toBe(401)
  })

  it('sign-up response carries the set-auth-token header', async () => {
    const res = await signUp()
    expect(res.status).toBe(200)
    const token = authToken(res)
    expect(token).toBeTruthy()
    expect(token.length).toBeGreaterThan(0)
  })

  it('sign-up response exposes set-auth-token via CORS', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:5173', // Client origin
        },
        body: JSON.stringify({
          email: 'alice@example.com',
          password: 'password123',
          username: 'alice',
          name: 'alice',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const exposeHeaders = res.headers.get('access-control-expose-headers')
    expect(exposeHeaders).toBeTruthy()
    expect(exposeHeaders).toContain('set-auth-token')
  })

  it('GET /api/profile/me with a valid bearer token returns the user', async () => {
    const signupRes = await signUp()
    expect(signupRes.status).toBe(200)
    const token = authToken(signupRes)

    const res = await app.handle(
      new Request('http://localhost/api/profile/me', {
        headers: bearer(token),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      id: expect.any(String),
      username: 'alice',
      role: 'user',
    })
  })

  it('GET /api/profile/me with invalid bearer token is 401', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/profile/me', {
        headers: bearer('not-a-real-token'),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('GET /api/profile/admin is 403 for a plain user with bearer token', async () => {
    const signupRes = await signUp()
    const token = authToken(signupRes)

    const res = await app.handle(
      new Request('http://localhost/api/profile/admin', {
        headers: bearer(token),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('blocks privilege escalation: role in the sign-up body is ignored', async () => {
    // The single highest-severity invariant in this codebase (auth.ts's
    // `role: { input: false }`) — this test is the automated version of the
    // manual curl+psql check run during the Better Auth migration. Now verified
    // over the bearer token path (the path the app actually uses).
    const signupRes = await signUp({
      email: 'eve@example.com',
      username: 'eve',
      role: 'admin',
    })
    expect(signupRes.status).toBe(200)
    const body = await signupRes.json()
    expect(body.user.role).toBe('user')

    // Also verify via the actual authorization path, not just the response body.
    const token = authToken(signupRes)
    const res = await app.handle(
      new Request('http://localhost/api/profile/admin', {
        headers: bearer(token),
      }),
    )
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

  it('sign-in response carries the set-auth-token header and token authenticates', async () => {
    await signUp()
    const signInRes = await app.handle(
      new Request('http://localhost/api/auth/sign-in/username', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'password123' }),
      }),
    )
    expect(signInRes.status).toBe(200)
    const token = authToken(signInRes)

    // Verify the token from sign-in actually authenticates
    const res = await app.handle(
      new Request('http://localhost/api/profile/me', {
        headers: bearer(token),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      id: expect.any(String),
      username: 'alice',
      role: 'user',
    })
  })
})
