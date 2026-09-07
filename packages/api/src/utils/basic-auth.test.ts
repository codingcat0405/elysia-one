import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { requireBasicAuth } from './basic-auth'
import { UnauthorizedError } from './http-errors'

function basicHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
}

function fakeSet() {
  return { headers: {} as Record<string, string> }
}

describe('requireBasicAuth', () => {
  const savedUser = process.env.BULL_BOARD_USER
  const savedPass = process.env.BULL_BOARD_PASSWORD

  beforeEach(() => {
    process.env.BULL_BOARD_USER = 'admin'
    process.env.BULL_BOARD_PASSWORD = 'secret123'
  })

  afterEach(() => {
    if (savedUser === undefined) delete process.env.BULL_BOARD_USER
    else process.env.BULL_BOARD_USER = savedUser
    if (savedPass === undefined) delete process.env.BULL_BOARD_PASSWORD
    else process.env.BULL_BOARD_PASSWORD = savedPass
  })

  it('throws UnauthorizedError with no Authorization header', () => {
    const set = fakeSet()
    expect(() => requireBasicAuth()({ headers: {}, set })).toThrow(UnauthorizedError)
    expect(set.headers['WWW-Authenticate']).toContain('Basic')
  })

  it('throws UnauthorizedError for a non-Basic scheme', () => {
    const set = fakeSet()
    expect(() =>
      requireBasicAuth()({ headers: { authorization: 'Bearer sometoken' }, set }),
    ).toThrow(UnauthorizedError)
  })

  it('throws UnauthorizedError for wrong credentials', () => {
    const set = fakeSet()
    expect(() =>
      requireBasicAuth()({
        headers: { authorization: basicHeader('admin', 'wrongpass') },
        set,
      }),
    ).toThrow(UnauthorizedError)
  })

  it('passes for correct credentials without throwing', () => {
    const set = fakeSet()
    expect(() =>
      requireBasicAuth()({
        headers: { authorization: basicHeader('admin', 'secret123') },
        set,
      }),
    ).not.toThrow()
  })

  it('rejects a username/password of different lengths without crashing', () => {
    // Regression guard for the length-mismatch branch in safeEqual() — a
    // naive timingSafeEqual() call on unequal-length buffers throws, which
    // would surface as a 500 instead of a clean 401.
    const set = fakeSet()
    expect(() =>
      requireBasicAuth()({
        headers: { authorization: basicHeader('admin', 'x') },
        set,
      }),
    ).toThrow(UnauthorizedError)
  })
})
