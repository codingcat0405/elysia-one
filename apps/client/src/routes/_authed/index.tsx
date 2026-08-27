import { createFileRoute, getRouteApi } from '@tanstack/react-router'

const authedRoute = getRouteApi('/_authed')

export const Route = createFileRoute('/_authed/')({
  component: HomePage,
})

function HomePage() {
  // read straight from the layout loader — no store round-trip, no stale first frame
  const { user } = authedRoute.useLoaderData()

  return (
    <main className="mx-auto flex max-w-md flex-col items-start gap-4 px-4 py-12">
      <h1 className="text-xl font-semibold">Home</h1>
      <p className="text-sm text-muted-foreground">
        Logged as ID: {user.id}, username: {user.username}
      </p>
    </main>
  )
}
