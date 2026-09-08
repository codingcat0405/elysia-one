import { describe, expect, it } from 'bun:test'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  UnauthorizedError,
} from './http-errors'

describe('http-errors', () => {
  it.each([
    [BadRequestError, 400, 'Bad request'],
    [UnauthorizedError, 401, 'Unauthorized'],
    [ForbiddenError, 403, 'Permission denied'],
    [NotFoundError, 404, 'Not found'],
    [ConflictError, 409, 'Conflict'],
  ] as const)(
    '%s defaults to status %d and message %s',
    (ErrorClass, status, message) => {
      const err = new ErrorClass()
      expect(err.status).toBe(status)
      expect(err.message).toBe(message)
      expect(err).toBeInstanceOf(HttpError)
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe(ErrorClass.name)
    },
  )

  it('accepts a custom message while keeping the fixed status', () => {
    const err = new NotFoundError('User not found')
    expect(err.status).toBe(404)
    expect(err.message).toBe('User not found')
  })

  it('errorMiddleware relies on instanceof HttpError to distinguish these from unexpected errors', () => {
    // Guards against a future refactor that swaps `class extends HttpError`
    // for a plain object/interface — errorMiddleware.ts's `error instanceof
    // HttpError` check would silently stop matching every subclass here.
    expect(new BadRequestError()).toBeInstanceOf(HttpError)
    expect(new Error('not an HttpError')).not.toBeInstanceOf(HttpError)
  })
})
