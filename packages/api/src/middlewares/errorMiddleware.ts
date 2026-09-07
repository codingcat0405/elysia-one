import { HttpError } from '../utils/http-errors'
import logger from '../utils/logger'

// https://elysiajs.com/patterns/error-handling.html
const errorMiddleware = ({ code, error, set }: any) => {
  // our own typed errors (thrown from services / macros)
  if (error instanceof HttpError) {
    set.status = error.status
    return { message: error.message, status: error.status }
  }

  if (code === 'VALIDATION') {
    set.status = 400
    // Elysia's VALIDATION error.message is normally JSON, but that's a
    // convention, not a guarantee — a malformed/unexpected message must not
    // throw *inside* this already-in-the-error-handler path, which would
    // otherwise replace a clean 400 with an unhandled-exception 500.
    let validationError: { summary?: string; errors?: unknown[] } | null = null
    try {
      validationError = JSON.parse(error.message)
    } catch {
      logger.error('VALIDATION error.message was not valid JSON', { raw: error.message })
    }
    return {
      message: validationError?.summary ?? 'Validation error',
      errors: validationError?.errors ?? [],
      status: 400
    }
  }

  if (code === 'NOT_FOUND') {
    set.status = 404
    return { message: 'Not found', status: 404 }
  }

  // everything else is a real bug: log details server-side, return a generic
  // message so DB/driver/internal errors never leak to clients
  logger.error(error)
  set.status = 500
  return { message: 'Internal server error', status: 500 }
}

export default errorMiddleware
