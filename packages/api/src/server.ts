import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import responseMiddleware from './middlewares/responseMiddleware'
import errorMiddleware from './middlewares/errorMiddleware'
import userController from './modules/user'
import { setup } from './middlewares/setup'
import { initORM } from './db'
import logger from './utils/logger'
import { createBullBoardPlugin } from './bull-board'

const startApp = async () => {


  const { orm } = await initORM() // same cached instance `setup.ts` forks from

  // .group()'s callback isn't async-aware — resolve the plugin first
  const bullBoardPlugin =
    process.env.ENABLE_BULL_BOARD === 'true' ? await createBullBoardPlugin() : null

  const app = new Elysia()
    .use(cors())
    .use(setup)
    .onAfterHandle(responseMiddleware)
    .onError(errorMiddleware)
    .get('/', () => "It's works!")
    .get('/health', () => ({ status: 'ok' }))
    .group('/api', (group) => group.use(userController))
  if (bullBoardPlugin) app.use(bullBoardPlugin)
  // compose everything BEFORE listen — never .use() after the server is live
  if (process.env.ENABLE_SWAGGER === 'true') {
    app.use(
      swagger({
        path: '/swagger-ui',
        provider: 'swagger-ui',
        documentation: {
          info: {
            title: 'Elysia Forge',
            description: 'Production Ready Elysia Template. API documentation',
            version: '1.0.0',
          },
          components: {
            securitySchemes: {
              JwtAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'Enter JWT Bearer token **_only_**',
              },
            },
          },
        },
        swaggerOptions: { persistAuthorization: true },
      }),
    )
  }

  app.listen(Number(process.env.PORT ?? 3000))

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down...`)
    await app.stop()
    await orm.close() // release the pool this process owns
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  return app
}

// `app` only exists inside startApp's closure (it needs `orm` from the async
// initORM() call before it can be built) — derive the Eden Treaty type from
// the function's return instead of exporting the instance itself.
export type App = Awaited<ReturnType<typeof startApp>>

startApp().catch((err) => {
  console.error(err)
  process.exit(1)
})
