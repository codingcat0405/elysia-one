import { Link, useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import ThemeToggle from './ThemeToggle'
import { clearToken } from '#/lib/auth.ts'
import { useUserStore } from '#/stores/user-store.ts'

export default function Header() {
  const navigate = useNavigate()
  const { user, clearUser } = useUserStore()
  const isAuthed = user.id !== 0

  const handleLogout = async () => {
    clearToken()
    clearUser()
    await navigate({ to: '/login' })
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
