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

export const Route = createFileRoute('/login')({
  // Cookie is unreadable from JS — check runs server-side (or client, on
  // client-side nav) via /users/me instead of a synchronous token read.
  beforeLoad: async () => {
    if (await fetchMe()) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const setUser = useUserStore((s) => s.setUser)

  const handleLogin = async ({ username, password }: Credentials) => {
    // The API already set the auth cookies on this response — nothing to store.
    const data = await unwrap(api.users.login.post({ username, password }))
    setUser(data.user)
    await navigate({ to: '/' })
  }

  return (
    <AuthForm
      title="Sign in"
      description="Enter your credentials to access your account."
      submitLabel="Sign in"
      passwordAutoComplete="current-password"
      onSubmit={handleLogin}
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
