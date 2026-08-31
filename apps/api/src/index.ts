import { Hono } from 'hono';
import { languageDetector } from 'hono/language';
import type { BaseAppEnv, AppRuntime } from './app-env';
import type { ManagedRuntime } from 'effect';
import { auth } from './lib/auth';
import { hasMalformedCallbackParam } from './lib/magic-link-guard';
import { resolveUiOrigin } from './lib/ui-origin';
import { appRoutes } from './routes/app/index';
import { credibledWebhookRoute } from './routes/webhooks/credibled';
import { requestId } from 'hono/request-id';
import { makeAppRuntime } from './managed-runtime';
import { ensureInitialAppState } from './startup';
import { API_BASE_PATH } from './hc';

export const createApp = (
  runtime: AppRuntime | ManagedRuntime.ManagedRuntime<any, never> = makeAppRuntime()
) => {
  const app = new Hono<BaseAppEnv>()
    .use('*', async (c, next) => {
      c.set('runtime', runtime as AppRuntime);
      await next();
    })
    .use('*', requestId())
    .use(
      '*',
      languageDetector({
        supportedLanguages: ['en', 'es'],
        fallbackLanguage: 'en'
      })
    )

    .get('/health', (c) => {
      return c.text('Up!');
    })

    .all('/api/auth/*', (c) => {
      // Mangled magic links would otherwise 500 inside better-auth.
      if (
        c.req.path.endsWith('/magic-link/verify') &&
        hasMalformedCallbackParam((key) => c.req.query(key))
      ) {
        return c.redirect(
          `${resolveUiOrigin(c.req.raw.headers)}/auth/sign-in/error?error=INVALID_TOKEN`
        );
      }
      return auth.handler(c.req.raw);
    })
    // Public ingress — deliberately OUTSIDE the app router and its session
    // middleware. Authenticity comes from the HMAC signature alone, and the
    // audience comes from the path because Credibled's payload identifies
    // neither the account nor the role.
    .route('/webhooks/credibled', credibledWebhookRoute)
    .route(API_BASE_PATH, appRoutes)

    .onError((error, c) => {
      console.error(error);

      return c.json(
        {
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Unexpected server error.'
          }
        },
        500
      );
    });

  return app;
};

/** Route types for the Hono RPC client (`hc<AppType>`) — import type-only from clients. */
export type AppType = ReturnType<typeof createApp>;

const runtime = makeAppRuntime();

if (process.env.NODE_ENV !== 'test') {
  await runtime.runPromise(ensureInitialAppState);
}

const app = createApp(runtime);

export default {
  fetch: app.fetch,
  // Bun's default idleTimeout (10s) closes connections with no traffic —
  // including SSE notification streams sitting between heartbeats. Keep it
  // comfortably above the stream's heartbeat interval.
  idleTimeout: 120
};
