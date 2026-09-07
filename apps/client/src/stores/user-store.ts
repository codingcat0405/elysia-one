import { create } from 'zustand'

export type User = {
  id: string
  username: string
  role: string
}

export type UserStore = {
  user: User
  setUser: (user: User) => void
  clearUser: () => void
}

const defaultUser: User = {
  id: '',
  username: '',
  role: 'user',
}

// `user.id === ''` means "not logged in" — Better Auth IDs are UUID strings, so
// the empty string replaces `0` as the logged-out sentinel. Keeps the Header
// branching on the store without a separate `isAuthenticated` flag.
export const useUserStore = create<UserStore>((set) => ({
  user: defaultUser,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: defaultUser }),
}))
