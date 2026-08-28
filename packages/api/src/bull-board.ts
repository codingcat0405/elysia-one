import { Elysia } from 'elysia'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ElysiaAdapter } from '@bull-board/elysia'
import { userQueue } from './modules/user/queue'
import { requireBasicAuth } from './utils/basic-auth';

// Exposes internal job payloads/data — must never be public.
// Mounted at top-level /bull-board (see index.ts), gated by HTTP Basic Auth
// (requireBasicAuth below) — not JWT. Keep it that way (see AGENTS.md).
export async function createBullBoardPlugin() {
  const serverAdapter = new ElysiaAdapter({
    prefix: '/bull-board',
    basePath: '/bull-board',
  })

  createBullBoard({
    // register one BullMQAdapter per queue here as the app grows
    queues: [new BullMQAdapter(userQueue)],
    serverAdapter,
    options: {
      // works around a Bun build issue caused by eval() in the default UI bundle
      uiBasePath: 'node_modules/@bull-board/ui',
    },
  })

  return new Elysia()
    .onBeforeHandle(requireBasicAuth())
    .use(await serverAdapter.registerPlugin())
}
