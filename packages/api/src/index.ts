import process from "node:process";
import { initORM } from "./db";
import logger from "./utils/logger";
import cors from "@elysiajs/cors";
import { setup } from "./middlewares/setup";
import responseMiddleware from "./middlewares/responseMiddleware";
import errorMiddleware from "./middlewares/errorMiddleware";
import userController from "./modules/user";
import Elysia from "elysia";
import swagger from "@elysiajs/swagger";

for (const key of ["JWT_SECRET", "DATABASE_URL"]) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}
if (process.env.ENABLE_BULL_BOARD === "true") {
  if (!process.env.BULL_BOARD_USER || !process.env.BULL_BOARD_PASSWORD) {
    throw new Error(
      "Missing required env var: BULL_BOARD_USER or BULL_BOARD_PASSWORD",
    );
  }
}

const main = async () => {
  const { orm } = await initORM();
  await orm.schema.updateSchema();
  // load lazily: @bull-board/elysia sync-requires elysia internally, which under
  // Bun must not run before elysia has been ES-imported (memoirist is async)
  const bullBoardPlugin =
    process.env.ENABLE_BULL_BOARD === "true"
      ? await (await import("./bull-board.js")).createBullBoardPlugin()
      : null;

  const app = new Elysia()
    .use(cors())
    .use(setup)
    .onAfterHandle(responseMiddleware)
    .onError(errorMiddleware)
    .get("/", () => "It's works!")
    .get("/health", () => ({ status: "ok" }))
    .group("/api", (group) => group.use(userController));
  if (bullBoardPlugin) app.use(bullBoardPlugin);
  // compose everything BEFORE listen — never .use() after the server is live
  if (process.env.ENABLE_SWAGGER === "true") {
    app.use(
      swagger({
        path: "/swagger-ui",
        provider: "swagger-ui",
        documentation: {
          info: {
            title: "Elysia Forge",
            description: "Production Ready Elysia Template. API documentation",
            version: "1.0.0",
          },
          components: {
            securitySchemes: {
              JwtAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
                description: "Enter JWT Bearer token **_only_**",
              },
            },
          },
        },
        swaggerOptions: { persistAuthorization: true },
      }),
    );
  }

  app.listen(Number(process.env.PORT ?? 3000));

  const port = process.env.PORT ?? 3000;
  console.log(`
  _____ _         _         ___
 | ____| |_   _ __(_) __ _  / _ \\ _ __   ___
 |  _| | | | | / __| |/ _\` || | | | '_ \\ / _ \\
 | |___| | |_| \\__ \\ | (_| || |_| | | | |  __/
 |_____|_|\\__, |___/_|\\__,_| \\___/|_| |_|\\___|
          |___/
  Elysia One — the all-in-one Turborepo Elysia + React template
  written by lilhuy0405
`);
  console.log(`🦊 Server:     http://localhost:${port}`);
  if (process.env.ENABLE_SWAGGER === "true") {
    console.log(`📚 Swagger:    http://localhost:${port}/swagger-ui`);
  }
  if (process.env.ENABLE_BULL_BOARD === "true") {
    console.log(
      `📊 Bull Board: http://localhost:${port}/bull-board (${process.env.BULL_BOARD_USER}:${process.env.BULL_BOARD_PASSWORD})`,
    );
  }
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down...`);
    await app.stop();
    await orm.close(); // release the pool this process owns
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  return app;
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
//eden treaty export type for FE apps
export type App = Awaited<ReturnType<typeof main>>;
