import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import ThemeToggle from './ThemeToggle'
import { api, unwrap } from '#/lib/eden-client.ts'
import { useUserStore } from '#/stores/user-store.ts'
import type { User } from '#/stores/user-store.ts'

// `initialUser` comes from __root's loader (SSR-aware — reads the httpOnly
// cookie via the incoming request). `useUserStore` is empty on the server and,
// on the client, is also still empty on the very first render (before this
// component's mount effect runs) — so both first renders agree with each
// other by preferring `initialUser` until hydration, avoiding a
// logged-out-then-flip flash. `hydrated` (not `user.id === 0`) gates the
// switch to the live store: `id === 0` alone can't tell "not yet seeded" apart
// from "just explicitly logged out", which would otherwise mask a real
// clearUser() behind the stale initialUser until the next navigation resolves.
export default function Header({ initialUser }: { initialUser: User | null }) {
  const navigate = useNavigate()
  const { user, setUser, clearUser } = useUserStore()
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (initialUser) setUser(initialUser)
    setHydrated(true)
  }, [initialUser, setUser])

  const displayUser = hydrated ? user : initialUser
  const isAuthed = displayUser != null && displayUser.id !== 0

  const handleLogout = async () => {
    // Clear local state and navigate even if the network call fails —
    // otherwise a user with no connectivity can never log out.
    try {
      await unwrap(api.users.logout.post())
    } catch {
      // ignore — cookies may already be gone/expired, that's still "logged out"
    } finally {
      clearUser()
      await navigate({ to: '/login' })
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-3 py-3 sm:py-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-[var(--sea-ink)] no-underline"
        >
          <span className="h-2 w-2 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]" />
          Elysia One
        </Link>

        <div className="ml-auto flex items-center gap-2 text-sm font-semibold">
          {isAuthed ? (
            <>
              <span className="text-[var(--sea-ink-soft)]">
                {displayUser.username}
              </span>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                Log out
              </Button>
            </>
          ) : (
            <>
              <Link to="/login" className="nav-link">
                Login
              </Link>
              <Link to="/register" className="nav-link">
                Register
              </Link>
            </>
          )}
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
