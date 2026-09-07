import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { AuthForm } from '#/components/auth-form.tsx'
import type { Credentials } from '#/components/auth-form.tsx'
import { authClient, getSessionUser } from '#/lib/auth-client.ts'

export const Route = createFileRoute('/register')({
  beforeLoad: async () => {
    if (await getSessionUser()) throw redirect({ to: '/' })
  },
  component: RegisterPage,
})

function RegisterPage() {
  const navigate = useNavigate()

  const handleRegister = async ({ username, email, password }: Credentials) => {
    // The installed better-auth@1.7.3's `username` plugin extends
    // `emailAndPassword` rather than replacing it — there is no
    // `signUp.username`. Registration goes through `signUp.email` with
    // `username` passed as an additional field (see packages/api/src/auth.ts's
    // `signUpEmail` body type). This deviates from the phase file's original
    // `signUp.username(...)` example, which does not exist on this version.
    // `email!` is safe here only because `emailField` below always requires it.
    const { error } = await authClient.signUp.email({
      email: email!,
      password,
      // Better Auth's core user requires a `name` — reusing the username keeps
      // one field out of the form instead of adding a "display name" input.
      name: username,
      username,
    })
    if (error) throw error // AuthForm renders error.message inline
    // signUp.username() returns a session directly — no follow-up sign-in call
    // needed. Do not call setUser here: _authed's loader/effect owns store
    // hydration (see _authed.tsx).
    await navigate({ to: '/' })
  }

  const handleGoogle = () => {
    // Redirects the browser away — nothing meaningful to await or catch here.
    void authClient.signIn.social({
      provider: 'google',
      callbackURL: `${window.location.origin}/`,
    })
  }

  return (
    <AuthForm
      title="Create account"
      description="Username 3-64 characters, password at least 8. Email is required."
      submitLabel="Create account"
      passwordAutoComplete="new-password"
      emailField
      onSubmit={handleRegister}
      onGoogle={handleGoogle}
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    />
  )
}
