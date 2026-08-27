import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { AuthForm } from '#/components/auth-form.tsx'
import type { Credentials } from '#/components/auth-form.tsx'
import { getToken, setToken } from '#/lib/auth.ts'
import { api, unwrap } from '#/lib/eden-client.ts'
import { useUserStore } from '#/stores/user-store.ts'

export const Route = createFileRoute('/login')({
  // token lives in localStorage — guard + redirect must run in the browser
  ssr: false,
  beforeLoad: () => {
    if (getToken()) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const setUser = useUserStore((s) => s.setUser)

  const handleLogin = async ({ username, password }: Credentials) => {
    const data = await unwrap(api.users.login.post({ username, password }))
    console.log(data)
    setToken(data.jwt)
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
