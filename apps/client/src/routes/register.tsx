import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { AuthForm } from '#/components/auth-form.tsx'
import type { Credentials } from '#/components/auth-form.tsx'
import { api, fetchMe, unwrap } from '#/lib/eden-client.ts'
import { useUserStore } from '#/stores/user-store.ts'

export const Route = createFileRoute('/register')({
  beforeLoad: async () => {
    if (await fetchMe()) throw redirect({ to: '/' })
  },
  component: RegisterPage,
})

function RegisterPage() {
  const navigate = useNavigate()
  const setUser = useUserStore((s) => s.setUser)

  const handleRegister = async ({ username, password }: Credentials) => {
    await unwrap(api.users.register.post({ username, password }))
    // log the user straight in on successful registration (same as old web app)
    // the login call sets the auth cookies — nothing left to store client-side.
    const data = await unwrap(api.users.login.post({ username, password }))
    setUser(data.user)
    await navigate({ to: '/' })
  }

  return (
    <AuthForm
      title="Create account"
      description="Username 3-64 characters, password at least 8."
      submitLabel="Create account"
      passwordAutoComplete="new-password"
      onSubmit={handleRegister}
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
