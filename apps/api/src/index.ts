import { Hono } from "hono";
import { languageDetector } from "hono/language";
import { ManagedRuntime } from "effect";
import type { BaseAppEnv, AppRuntime } from "./app-env";
import { auth } from "./lib/auth";
import { appRoutes } from "./routes/app/index";
import { requestId } from "hono/request-id";
import { AppLive } from "./managed-runtime";

export const createApp = (runtime: AppRuntime = ManagedRuntime.make(AppLive)) => {
  const app = new Hono<BaseAppEnv>()
  .use("*", async (c, next) => {
    c.set("runtime", runtime);
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

export default createApp();
