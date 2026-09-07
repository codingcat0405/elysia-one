import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { AuthForm } from '#/components/auth-form.tsx'
import type { Credentials } from '#/components/auth-form.tsx'
import { authClient, getSessionUser } from '#/lib/auth-client.ts'

export const Route = createFileRoute('/login')({
  // Session cookie is httpOnly — check runs server-side (or client, on
  // client-side nav) via getSessionUser() instead of a synchronous token read.
  beforeLoad: async () => {
    if (await getSessionUser()) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()

  const handleLogin = async ({ username, password }: Credentials) => {
    // The installed better-auth version's username plugin looks up strictly by
    // the `username` field (no email fallback) — login is username-only.
    const { error } = await authClient.signIn.username({ username, password })
    if (error) throw error // AuthForm renders error.message inline
    // Do not call setUser here: _authed's loader/effect owns store hydration.
    await navigate({ to: '/' })
  }

  const handleGoogle = async () => {
    // On success this redirects the browser away before returning. On
    // failure (e.g. Google not configured on this deployment) it resolves
    // with `{ error }` rather than throwing — same convention as
    // signIn.username/signIn.email — so AuthForm's catch needs a real throw.
    const { error } = await authClient.signIn.social({
      provider: 'google',
      callbackURL: `${window.location.origin}/`,
    })
    if (error) throw error
  }

  return (
    <AuthForm
      title="Sign in"
      description="Enter your credentials to access your account."
      submitLabel="Sign in"
      passwordAutoComplete="current-password"
      onSubmit={handleLogin}
      onGoogle={handleGoogle}
      footer={
        <>
          No account?{' '}
          <Link to="/register" className="underline underline-offset-4">
            Create one
          </Link>
        </>
      }
    />
  )
}
