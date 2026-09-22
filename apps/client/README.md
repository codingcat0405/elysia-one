# Elysia One — client

TanStack Start + React 19 frontend for the `elysia-one` monorepo. Talks to `packages/api` exclusively through an Eden-Treaty-typed client — see the root [`AGENTS.md`](../../AGENTS.md) for the FE/BE contract, and this package's [`AGENTS.md`](./AGENTS.md) for frontend-specific rules before extending it.

## Stack

- [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) (file-based routing, `src/routes/`)
- React 19, Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com/) (`components/ui/`, style: `new-york`)
- [Zustand](https://zustand.docs.pmnd.rs/) for global client state (currently: the logged-in user)
- [`@elysia/eden`](https://elysiajs.com/eden/overview.html) (Eden Treaty) for a fully-typed API client generated from `packages/api`'s `App` type
- [Better Auth](https://better-auth.com) (username/password + optional Google OAuth) via `src/lib/auth-client.ts` — the one sanctioned non-Eden path to the API; session token is stored in `localStorage` via `src/lib/auth-token.ts`

## Getting started

Requires `packages/api` to be running (for actual requests) **and built at least once** (for types — see "Type safety" below).

```bash
cp .env.example .env   # VITE_API_URL, defaults to http://localhost:3000
bun install
bun run dev             # http://localhost:3001
```

From the repo root, `bun run dev` (Turborepo) starts both `apps/client` and `packages/api` together.

## Building for production

```bash
bun run build
bun run preview
```

Docker: `Dockerfile` (build from the repo root: `docker build -f apps/client/Dockerfile -t client .`) — runs `vite build`'s SSR output (`dist/server/server.js`), not `preview`. See the root [`README.md`](../../README.md#docker) for the full local stack via `docker-compose.yml`, including why the client container needs `network_mode: host`.

## Auth

- Better Auth returns a session token in the `set-auth-token` response header on sign-in/sign-up (username/password or Google). The token is captured by `src/lib/auth-client.ts` and stored in `localStorage` via `src/lib/auth-token.ts` (namespaced key: `elysia-one.auth_token`). Auth state is derived by calling `getSessionUser()`, which wraps Better Auth's own `authClient.getSession()`.
- Global "who's logged in" state is a Zustand store (`src/stores/user-store.ts`). `user.id === ''` is the "logged out" sentinel (Better Auth IDs are UUID strings) — there's no separate boolean flag.
- `src/routes/_authed.tsx` is a pathless layout route with a **browser-only mount effect** (not an SSR loader): it calls `getSessionUser()` to validate the session behind a loading state, hydrates the store, and redirects to `/login` on any failure. This is the _only_ place that invalidates a token. Add new authenticated screens as children of `_authed`, not with a per-route auth check. A separate `__root.tsx` display-only sync effect populates the store for the `Header` on public pages (never redirects).
- `login.tsx` / `register.tsx` are **SSR-enabled** (not `ssr: false`) — routes stay SSR-enabled by default, though auth decisions happen client-side (no token in `localStorage` during SSR). They share one form component, `components/auth-form.tsx`. Login is **username-only** (no email fallback — the installed `better-auth` version's `username` plugin has no such option); registration calls `authClient.signUp.email(...)` with `username` passed as an extra field, since there is no `signUp.username`.

## Type safety (Eden Treaty)

`src/lib/eden-client.ts` builds its `api` client from `import type { App } from 'api'` — the Elysia app type exported by `packages/api/src/index.ts`. This gives compile-time-checked routes, request bodies, and response shapes with no manually-written API types.

This only works once `packages/api` has been built (`bun run build` there, or `bunx turbo build --filter=api` from the root) — that's what produces `dist/index.d.ts`, which is what this package's `types` resolution actually reads. It is **not** rebuilt automatically by `bun run dev`. If routes/types look stale, rebuild `packages/api` first.

## Code quality (linting & formatting)

- **Linting:** `bun run lint` (from root or here) runs `oxlint` via Turborepo — shared config at the repo root covers all workspaces.
- **Formatting:** `bun run format` and `bun run format:check` run from the repo root only (not via Turborepo) with Prettier's shared root-level config.

## Conventions

- Import alias `#/*` → `src/*` (see `tsconfig.json` / `package.json`'s `imports`) — used instead of relative `../../` paths.
- shadcn/ui components live in `src/components/ui/`; add new ones with `bunx --bun shadcn@latest add <component>` rather than hand-rolling primitives.
- File-based routing: add a route by adding a file under `src/routes/`; `tsr generate` (wired into `dev`/`build`) regenerates `src/routeTree.gen.ts` — don't hand-edit that file.

See [`AGENTS.md`](./AGENTS.md) for the full list of conventions AI agents and contributors must not break.
