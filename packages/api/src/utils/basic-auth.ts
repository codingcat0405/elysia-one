import { timingSafeEqual } from 'node:crypto'
import { UnauthorizedError } from './http-errors'

// Constant-time string compare — plain `===` leaks timing info character
// by character, letting an attacker brute-force credentials faster.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  // lengths must match for timingSafeEqual; compare against a same-length
  // buffer either way so a length mismatch doesn't short-circuit visibly
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA) // burn equivalent time, result unused
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

// Elysia onBeforeHandle-compatible basic auth check.
// Reads credentials from env so nothing is hardcoded in source.
export function requireBasicAuth() {
  return ({ headers, set }: { headers: Record<string, string | undefined>; set: any }) => {
    const expectedUser = process.env.BULL_BOARD_USER!
    const expectedPass = process.env.BULL_BOARD_PASSWORD!
    const header = headers.authorization
    if (!header?.startsWith('Basic ')) {
      set.headers['WWW-Authenticate'] = 'Basic realm="Restricted", charset="UTF-8"'
      throw new UnauthorizedError('Authentication required')
    }

    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf-8')
    const sepIndex = decoded.indexOf(':')
    const user = sepIndex === -1 ? decoded : decoded.slice(0, sepIndex)
    const pass = sepIndex === -1 ? '' : decoded.slice(sepIndex + 1)

    if (!safeEqual(user, expectedUser) || !safeEqual(pass, expectedPass)) {
      set.headers['WWW-Authenticate'] = 'Basic realm="Restricted", charset="UTF-8"'
      throw new UnauthorizedError('Invalid credentials')
    }
  }
}
