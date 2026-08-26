import { Elysia } from 'elysia'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ElysiaAdapter } from '@bull-board/elysia'
import { userQueue } from './modules/user/queue'
import { requireBasicAuth } from './utils/basic-auth';

// Exposes internal job payloads/data — must never be public.
// Mounted at /api/admin/queues (see server.ts), gated by admin JWT auth.
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
