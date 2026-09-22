import { beforeEach, afterEach, describe, expect, it } from 'bun:test'
import { getAuthToken, setAuthToken, clearAuthToken } from './auth-token'

describe('auth-token storage', () => {
  let originalLocalStorage: Storage | undefined

  beforeEach(() => {
    // Save original localStorage
    originalLocalStorage = globalThis.localStorage

    // Set up in-memory localStorage stub using a mutable storage object
    const storage: Record<string, string> = {}

    const mockStorage: Storage = {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value
      },
      removeItem: (key: string) => {
        delete storage[key]
      },
      clear: () => {
        for (const key of Object.keys(storage)) {
          delete storage[key]
        }
      },
      length: 0,
      key: () => null,
    }

    // Ensure window exists and has localStorage
    if (typeof globalThis.window === 'undefined') {
      Object.defineProperty(globalThis, 'window', {
        value: { localStorage: mockStorage },
        writable: true,
        configurable: true,
      })
    } else {
      // Replace localStorage on existing window
      Object.defineProperty(globalThis.window, 'localStorage', {
        value: mockStorage,
        writable: true,
        configurable: true,
      })
    }
  })

  afterEach(() => {
    // Restore original localStorage
    if (originalLocalStorage !== undefined && globalThis.window) {
      Object.defineProperty(globalThis.window, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      })
    }
  })

  it('setAuthToken stores and getAuthToken retrieves the token', () => {
    const token = 'test-token-abc123'
    setAuthToken(token)
    const retrieved = getAuthToken()
    expect(retrieved).toBe(token)
  })

  it('clearAuthToken removes the token', () => {
    const token = 'test-token-xyz789'
    setAuthToken(token)
    expect(getAuthToken()).toBe(token)

    clearAuthToken()
    expect(getAuthToken()).toBeNull()
  })

  it('getAuthToken returns null when no token is stored', () => {
    const token = getAuthToken()
    expect(token).toBeNull()
  })

  it('getAuthToken returns null when window is undefined (SSR)', () => {
    const originalWindow = globalThis.window
    delete (globalThis as any).window

    const token = getAuthToken()
    expect(token).toBeNull()

    // Restore window
    globalThis.window = originalWindow
  })

  it('setAuthToken does nothing when window is undefined (SSR)', () => {
    const originalWindow = globalThis.window
    delete (globalThis as any).window

    // Should not throw
    expect(() => {
      setAuthToken('token')
    }).not.toThrow()

    // Restore window for next test
    globalThis.window = originalWindow
  })

  it('clearAuthToken does nothing when window is undefined (SSR)', () => {
    const originalWindow = globalThis.window
    delete (globalThis as any).window

    // Should not throw
    clearAuthToken()

    globalThis.window = originalWindow
  })

  it('getAuthToken returns null when localStorage throws', () => {
    // Replace getItem with a throwing implementation
    ;(window.localStorage.getItem as any) = () => {
      throw new Error('Storage quota exceeded')
    }

    const token = getAuthToken()
    expect(token).toBeNull()
  })

  it('setAuthToken silently fails when localStorage throws', () => {
    // Replace setItem with a throwing implementation
    ;(window.localStorage.setItem as any) = () => {
      throw new Error('Storage quota exceeded')
    }

    // Should not throw
    expect(() => {
      setAuthToken('token')
    }).not.toThrow()
  })

  it('clearAuthToken silently fails when localStorage throws', () => {
    // Replace removeItem with a throwing implementation
    ;(window.localStorage.removeItem as any) = () => {
      throw new Error('Storage quota exceeded')
    }

    // Should not throw
    expect(() => {
      clearAuthToken()
    }).not.toThrow()
  })
})
