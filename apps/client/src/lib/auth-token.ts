// Bearer token storage. Replaces the httpOnly session cookie: the token now
// lives in localStorage and is attached by hand as `Authorization: Bearer`
// on every request (see auth-client.ts / eden-client.ts). Every function here
// guards against running outside the browser (SSR has no `window`) and
// against `localStorage` throwing (Safari private mode / storage disabled) —
// both degrade to "logged out" rather than crashing the app.
const AUTH_TOKEN_KEY = 'elysia-one.auth_token'

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token)
  } catch {
    // storage unavailable — nothing to do, the app degrades to logged-out
  }
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(AUTH_TOKEN_KEY)
  } catch {
    // storage unavailable — nothing to do
  }
}
