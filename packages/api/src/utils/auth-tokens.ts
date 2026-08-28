import jwt from 'jsonwebtoken'

export const ACCESS_COOKIE = 'access_token'
export const REFRESH_COOKIE = 'refresh_token'

export interface TokenSubject {
  id: number
  role: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

// cast: @types/jsonwebtoken types expiresIn as ms.StringValue, env vars are plain strings
const asExpiresIn = (v: string) => v as jwt.SignOptions['expiresIn']

// Read process.env inside the function, not at module scope, so a missing var
// surfaces at the boot check (index.ts) rather than at import order.
export function signTokenPair({ id, role }: TokenSubject): TokenPair {
  const accessToken = jwt.sign(
    { id, role },
    process.env.JWT_SECRET!,
    { expiresIn: asExpiresIn(process.env.JWT_EXPIRES_IN ?? '15m') },
  )
  const refreshToken = jwt.sign(
    { id },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: asExpiresIn(process.env.JWT_REFRESH_EXPIRES_IN ?? '30d') },
  )
  return { accessToken, refreshToken }
}

export function verifyRefreshToken(token: string): { id: number } {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { id: number }
}

function maxAgeOf(token: string): number {
  const { exp } = jwt.decode(token) as { exp?: number }
  if (!Number.isFinite(exp)) throw new Error('Signed token is missing an exp claim')
  return exp! - Math.floor(Date.now() / 1000)
}

// Shared between set and clear so a clear can never drift from how the cookie
// was written (a mismatched domain/path silently leaves the cookie in place).
function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  }
}

export function setAuthCookies(cookie: Record<string, any>, pair: TokenPair): void {
  cookie[ACCESS_COOKIE].set({
    value: pair.accessToken,
    maxAge: maxAgeOf(pair.accessToken),
    ...cookieOptions(),
  })
  cookie[REFRESH_COOKIE].set({
    value: pair.refreshToken,
    maxAge: maxAgeOf(pair.refreshToken),
    ...cookieOptions(),
  })
}

export function clearAuthCookies(cookie: Record<string, any>): void {
  cookie[ACCESS_COOKIE].set({ value: '', maxAge: 0, ...cookieOptions() })
  cookie[REFRESH_COOKIE].set({ value: '', maxAge: 0, ...cookieOptions() })
}
