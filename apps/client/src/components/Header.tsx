import { Link, useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import ThemeToggle from './ThemeToggle'
import { signOut } from '#/lib/auth-client.ts'
import { useUserStore } from '#/stores/user-store.ts'

// No SSR session anymore — the store is empty on the server and on the
// client's first render alike, so both agree (logged-out) and there is no
// hydration mismatch to guard against. This does mean every first paint
// flashes logged-out for one round-trip until a sync effect (`_authed.tsx`'s
// guard, or `__root.tsx`'s display-only sync on public pages) populates the
// store — unavoidable without a cookie.
export default function Header() {
  const navigate = useNavigate()
  const { user, clearUser } = useUserStore()
  const isAuthed = user.id !== ''

  const handleLogout = async () => {
    // Clear local state and navigate even if the network call fails —
    // otherwise a user with no connectivity can never log out. signOut()
    // (lib/auth-client.ts) always clears the stored token in its `finally`.
    try {
      await signOut()
    } catch {
      // ignore — session may already be gone/expired, that's still "logged out"
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
                {user.username}
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
