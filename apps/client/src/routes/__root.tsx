import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { useEffect } from 'react'
import Header from '../components/Header'
import { getSessionUser } from '../lib/auth-client'
import { getAuthToken } from '../lib/auth-token'
import { useUserStore } from '../stores/user-store'

import appCss from '../styles.css?url'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Elysia One',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {error instanceof Error ? error.message : 'Unexpected error'}
      </p>
    </main>
  ),
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const setUser = useUserStore((s) => s.setUser)

  // Display-only sync, NOT a gate: populates the store so `Header` shows the
  // right username on any page — public or authed — not just inside
  // `_authed` routes. Client-only (`[]` deps), runs once on mount.
  //
  // Deliberately does none of what `_authed.tsx`'s guard does:
  //   - no redirect on a null session — a public page is a legitimate place
  //     to be logged out;
  //   - no `clearAuthToken()` — token invalidation stays the guard's job
  //     alone, so two effects never race to clear the same key, and a
  //     network blip here can't wipe out an otherwise-valid token;
  //   - no `status` / loading state — this never gates rendering.
  //
  // Accepted redundancy: landing directly on an `_authed` route fires this
  // effect *and* the guard's, so `getSessionUser()` runs twice. Not worth
  // deduplicating/caching at this scope (same YAGNI stance as "no retry
  // logic" elsewhere in this change).
  useEffect(() => {
    let cancelled = false
    if (!getAuthToken()) return

    void getSessionUser().then((user) => {
      if (cancelled || !user) return
      // Resolves after an await inside an effect — intentional, this is the
      // only way to learn the session outcome on the client.
      // oxlint-disable-next-line react/set-state-in-effect
      setUser(user)
    })

    return () => {
      cancelled = true
    }
  }, [setUser])

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
        <Header />
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
