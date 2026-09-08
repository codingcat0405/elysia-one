import { describe, expect, it } from 'bun:test'
import { useUserStore } from './user-store'

describe('useUserStore', () => {
  it('defaults to the logged-out sentinel (empty-string id)', () => {
    expect(useUserStore.getState().user).toEqual({
      id: '',
      username: '',
      role: 'user',
    })
  })

  it('setUser replaces the whole user object', () => {
    useUserStore
      .getState()
      .setUser({ id: 'abc-123', username: 'alice', role: 'admin' })
    expect(useUserStore.getState().user).toEqual({
      id: 'abc-123',
      username: 'alice',
      role: 'admin',
    })
  })

  it('clearUser resets back to the logged-out sentinel', () => {
    useUserStore
      .getState()
      .setUser({ id: 'abc-123', username: 'alice', role: 'admin' })
    useUserStore.getState().clearUser()
    expect(useUserStore.getState().user).toEqual({
      id: '',
      username: '',
      role: 'user',
    })
  })
})
