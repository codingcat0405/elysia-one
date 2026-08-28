# Elysia One — client

TanStack Start + React 19 frontend for the `elysia-one` monorepo. Talks to `packages/api` exclusively through an Eden-Treaty-typed client — see the root [`AGENTS.md`](../../AGENTS.md) for the FE/BE contract, and this package's [`AGENTS.md`](./AGENTS.md) for frontend-specific rules before extending it.

## Stack

- [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) (file-based routing, `src/routes/`)
- React 19, Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com/) (`components/ui/`, style: `new-york`)
- [Zustand](https://zustand.docs.pmnd.rs/) for global client state (currently: the logged-in user)
- [`@elysia/eden`](https://elysiajs.com/eden/overview.html) (Eden Treaty) for a fully-typed API client generated from `packages/api`'s `App` type
- JWT bearer auth, token kept in `localStorage`

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

## Auth

- JWT lives in `localStorage` (`src/lib/auth.ts`: `getToken`/`setToken`/`clearToken`), attached as `Authorization: Bearer <token>` by `src/lib/eden-client.ts`.
- Global "who's logged in" state is a Zustand store (`src/stores/user-store.ts`). `user.id === 0` is the "logged out" sentinel — there's no separate boolean flag.
- `src/routes/_authed.tsx` is a pathless layout route: it guards on `getToken()`, fetches `/users/me` to hydrate the store, and clears the token + redirects to `/login` on any failure. Add new authenticated screens as children of `_authed`, not with a per-route auth check.
- `login.tsx` / `register.tsx` are `ssr: false` (token checks are browser-only) and share one form component, `components/auth-form.tsx`.

## Type safety (Eden Treaty)

`src/lib/eden-client.ts` builds its `api` client from `import type { App } from 'api'` — the Elysia app type exported by `packages/api/src/index.ts`. This gives compile-time-checked routes, request bodies, and response shapes with no manually-written API types.

This only works once `packages/api` has been built (`bun run build` there, or `bunx turbo build --filter=api` from the root) — that's what produces `dist/index.d.ts`, which is what this package's `types` resolution actually reads. It is **not** rebuilt automatically by `bun run dev`. If routes/types look stale, rebuild `packages/api` first.

## Conventions

- Import alias `#/*` → `src/*` (see `tsconfig.json` / `package.json`'s `imports`) — used instead of relative `../../` paths.
- shadcn/ui components live in `src/components/ui/`; add new ones with `bunx --bun shadcn@latest add <component>` rather than hand-rolling primitives.
- File-based routing: add a route by adding a file under `src/routes/`; `tsr generate` (wired into `dev`/`build`) regenerates `src/routeTree.gen.ts` — don't hand-edit that file.

See [`AGENTS.md`](./AGENTS.md) for the full list of conventions AI agents and contributors must not break.
