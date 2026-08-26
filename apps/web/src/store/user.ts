import { create } from "zustand";

export type User = {
  id: number;
  username: string;
  role: string;
};

export type UserStore = {
  user: User;
  setUser: (user: User) => void;
  clearUser: () => void;
};

const defaultUser: User = {
  id: 0,
  username: "",
  role: "user",
};
const useUserStore = create<UserStore>((set) => ({
  user: defaultUser,
  setUser: (user: User) => set({ user }),
  clearUser: () => set({ user: defaultUser }),
}));

export default useUserStore;
