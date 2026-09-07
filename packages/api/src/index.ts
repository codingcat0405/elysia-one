import process from "node:process";
import { RequestContext } from "@mikro-orm/postgresql";
import { initORM } from "./db";
import { initAuth } from "./auth";
import logger from "./utils/logger";
import cors from "@elysiajs/cors";
import { setup } from "./middlewares/setup";
import responseMiddleware from "./middlewares/responseMiddleware";
import errorMiddleware from "./middlewares/errorMiddleware";
import profileController from "./modules/profile";
import Elysia from "elysia";
import swagger from "@elysiajs/swagger";

for (const key of ["BETTER_AUTH_SECRET", "DATABASE_URL", "REDIS_URL"]) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}
// Google sign-in is opt-in and must stay fully optional (no Google Cloud
// Console credentials required to boot this template) — but exactly one var
// set is unambiguously a misconfiguration, not a valid "disabled" state.
if (Boolean(process.env.GOOGLE_CLIENT_ID) !== Boolean(process.env.GOOGLE_CLIENT_SECRET)) {
  throw new Error(
    "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set to enable Google sign-in, or both left unset to disable it",
  );
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
  const auth = await initAuth();
  // load lazily: @bull-board/elysia sync-requires elysia internally, which under
  // Bun must not run before elysia has been ES-imported (memoirist is async)
  const bullBoardPlugin =
    process.env.ENABLE_BULL_BOARD === "true"
      ? await (await import("./bull-board.js")).createBullBoardPlugin()
      : null;

  // A wildcard/reflected origin makes the browser discard the auth cookies when
  // credentials:true — origin must be an explicit list, never `true`/`*`.
  const clientOrigins = (process.env.CLIENT_URL ?? "http://localhost:3001")
    .split(",")
    .map((s) => s.trim());

  const app = new Elysia()
    .use(cors({ origin: clientOrigins, credentials: true }))
    // `better-auth-mikro-orm@0.5.0` calls `orm.em.*` directly — it does NOT
    // fork the EntityManager itself (confirmed in Phase 01: it throws
    // MikroORM's own "Using global EntityManager instance methods ..."
    // ValidationError without this wrapper). RequestContext.create() is
    // MikroORM's documented fix for exactly this situation (third-party code
    // holding a reference to the global `em`): every `orm.em.*` call made
    // inside this callback transparently resolves to a per-request fork via
    // AsyncLocalStorage, with no `allowGlobalContext` escape hatch needed.
    // Placed BEFORE `.use(setup)` so this mount never pays for a
    // `setup`-derived `em.fork()` it never uses (setup.ts's fork is a
    // separate, independent context and is unaffected).
    .mount((request) => RequestContext.create(orm.em, () => auth.handler(request)))
    .use(setup)
    .onAfterHandle(responseMiddleware)
    .onError(errorMiddleware)
    .get("/", () => "It's works!")
    .get("/health", () => ({ status: "ok" }))
    .group("/api", (group) => group.use(profileController));
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
              SessionCookie: {
                type: "apiKey",
                in: "cookie",
                name: "better-auth.session_token",
                description:
                  "Better Auth session cookie. Sign in via POST /api/auth/sign-in/username (same origin as this Swagger UI); the browser stores the cookie and subsequent \"Try it out\" calls carry it.",
              },
            },
          },
        },
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
