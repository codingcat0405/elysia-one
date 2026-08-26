import { HttpError } from '../utils/http-errors'

// https://elysiajs.com/patterns/error-handling.html
const errorMiddleware = ({ code, error, set }: any) => {
  // our own typed errors (thrown from services / macros)
  if (error instanceof HttpError) {
    set.status = error.status
    return { message: error.message, status: error.status }
  }

  if (code === 'VALIDATION') {
    set.status = 400
    const validationError = JSON.parse(error.message)
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
  console.error(error)
  set.status = 500
  return { message: 'Internal server error', status: 500 }
}

export default errorMiddleware
