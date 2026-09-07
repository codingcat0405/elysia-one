import { describe, expect, it } from 'bun:test'
import { unwrap } from './eden-client'

describe('unwrap', () => {
  it('returns the data on a successful call', async () => {
    const result = await unwrap(Promise.resolve({ data: { id: 1 }, error: null }))
    expect(result).toEqual({ id: 1 })
  })

  it('throws the error value (not the Eden error wrapper) on failure', async () => {
    const apiError = { message: 'Not found', status: 404 }
    await expect(
      unwrap(Promise.resolve({ data: null, error: { status: 404, value: apiError } })),
    ).rejects.toEqual(apiError)
  })

  it('throws when data is null/undefined even without an explicit error', async () => {
    // Guards the `data == null` fallback branch — an Eden response with
    // neither a real body nor an error shouldn't silently resolve to `null`
    // for a caller expecting `NonNullable<TData>`.
    await expect(
      unwrap(Promise.resolve({ data: null, error: null })),
    ).rejects.toThrow('Empty response from server')
  })
})
