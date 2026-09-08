import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { getClientOrigins } from './client-origins'

describe('getClientOrigins', () => {
  const original = process.env.CLIENT_URL

  beforeEach(() => {
    delete process.env.CLIENT_URL
  })

  afterEach(() => {
    if (original === undefined) delete process.env.CLIENT_URL
    else process.env.CLIENT_URL = original
  })

  it('defaults to the vite dev port when CLIENT_URL is unset', () => {
    expect(getClientOrigins()).toEqual(['http://localhost:3001'])
  })

  it('splits a single origin into a one-element array', () => {
    process.env.CLIENT_URL = 'https://app.example.com'
    expect(getClientOrigins()).toEqual(['https://app.example.com'])
  })

  it('splits multiple comma-separated origins and trims whitespace', () => {
    process.env.CLIENT_URL =
      'https://app.example.com, https://staging.example.com ,http://localhost:3001'
    expect(getClientOrigins()).toEqual([
      'https://app.example.com',
      'https://staging.example.com',
      'http://localhost:3001',
    ])
  })
})
