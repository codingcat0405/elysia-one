import { describe, expect, it } from 'bun:test'
import errorMiddleware from './errorMiddleware'
import { ForbiddenError } from '../utils/http-errors'

function fakeSet() {
  return { status: 200 as number }
}

describe('errorMiddleware', () => {
  it('maps an HttpError to its own status and message', () => {
    const set = fakeSet()
    const result = errorMiddleware({
      code: 'UNKNOWN',
      error: new ForbiddenError(),
      set,
    })
    expect(set.status).toBe(403)
    expect(result).toEqual({ message: 'Permission denied', status: 403 })
  })

  it('maps a well-formed VALIDATION error to 400 with its summary/errors', () => {
    const set = fakeSet()
    const error = {
      message: JSON.stringify({
        summary: 'Bad body',
        errors: ['username required'],
      }),
    }
    const result = errorMiddleware({ code: 'VALIDATION', error, set })
    expect(set.status).toBe(400)
    expect(result).toEqual({
      message: 'Bad body',
      errors: ['username required'],
      status: 400,
    })
  })

  it('falls back to a generic validation message instead of throwing on malformed JSON', () => {
    // Regression guard: JSON.parse(error.message) used to run unguarded
    // inside this already-in-the-error-handler path — a malformed message
    // would throw here and replace a clean 400 with an unhandled 500.
    const set = fakeSet()
    const error = { message: 'not valid json {{{' }
    const result = errorMiddleware({ code: 'VALIDATION', error, set })
    expect(set.status).toBe(400)
    expect(result).toEqual({
      message: 'Validation error',
      errors: [],
      status: 400,
    })
  })

  it('maps NOT_FOUND to a generic 404', () => {
    const set = fakeSet()
    const result = errorMiddleware({
      code: 'NOT_FOUND',
      error: new Error('unused'),
      set,
    })
    expect(set.status).toBe(404)
    expect(result).toEqual({ message: 'Not found', status: 404 })
  })

  it('maps anything else to a generic 500 without leaking the internal error text', () => {
    const set = fakeSet()
    const error = new Error(
      'duplicate key value violates unique constraint "user_email_unique"',
    )
    const result = errorMiddleware({ code: 'UNKNOWN', error, set })
    expect(set.status).toBe(500)
    expect(result).toEqual({ message: 'Internal server error', status: 500 })
  })
})
