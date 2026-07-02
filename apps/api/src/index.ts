import { Hono } from "hono";
import { languageDetector } from "hono/language";
import type { BaseAppEnv, AppRuntime } from "./app-env";
import type { ManagedRuntime } from "effect";
import { auth } from "./lib/auth";
import { appRoutes } from "./routes/app/index";
import { requestId } from "hono/request-id";
import { makeAppRuntime } from "./managed-runtime";
import { ensureInitialAppState } from "./startup";

export const createApp = (runtime: AppRuntime | ManagedRuntime.ManagedRuntime<any, never> = makeAppRuntime()) => {
  const app = new Hono<BaseAppEnv>()
  .use("*", async (c, next) => {
    c.set("runtime", runtime as AppRuntime);
    await next();
  })
	.use('*', requestId())
  .use(
    "*",
    languageDetector({
      supportedLanguages: ["en", "es"],
      fallbackLanguage: "en",
    }),
  )

  .get("/health", (c) => {
    return c.text("Up!");
  })

  .all("/api/auth/*", (c) => auth.handler(c.req.raw))
  .route("/app/api/v1", appRoutes)

  .onError((error, c) => {
    console.error(error);

    return c.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Unexpected server error.",
        },
      },
      500,
    );
  })

  return app;
};

const runtime = makeAppRuntime();

if (process.env.NODE_ENV !== "test") {
  await runtime.runPromise(ensureInitialAppState);
}

export default createApp(runtime);
