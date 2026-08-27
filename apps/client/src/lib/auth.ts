// JWT access token lives in localStorage (same model as the old web app).
// Every helper is SSR-safe: TanStack Start renders on the server where there is
// no `window`, and auth routes are `ssr: false` but these may still be imported
// into modules that load during SSR.

export const ACCESS_TOKEN_KEY = 'elysia_mono_jwt'

const hasLocalStorage = () =>
  typeof window !== 'undefined' && !!window.localStorage

export const getToken = (): string | null => {
  if (!hasLocalStorage()) return null
  const token = window.localStorage.getItem(ACCESS_TOKEN_KEY)
  // guard against a stringified `undefined`/`null` written by an earlier bug
  return token && token !== 'undefined' && token !== 'null' ? token : null
}

export const setToken = (token: string): void => {
  if (!token || typeof token !== 'string') {
    throw new Error('setToken called with a non-string token')
  }
  if (hasLocalStorage()) window.localStorage.setItem(ACCESS_TOKEN_KEY, token)
}

export const clearToken = (): void => {
  if (hasLocalStorage()) window.localStorage.removeItem(ACCESS_TOKEN_KEY)
}
