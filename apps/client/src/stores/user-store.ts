import { create } from 'zustand'

export type User = {
  id: number
  username: string
  role: string
}

export type UserStore = {
  user: User
  setUser: (user: User) => void
  clearUser: () => void
}

const defaultUser: User = {
  id: 0,
  username: '',
  role: 'user',
}

// `user.id === 0` means "not logged in" — mirrors the old web app so the Header
// can branch on it without a separate flag.
export const useUserStore = create<UserStore>((set) => ({
  user: defaultUser,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: defaultUser }),
}))
