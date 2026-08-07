import { NotificationHub, type AppNotification, type NotificationSubscription } from '@repo/notify';
import { Effect, Exit } from 'effect';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { HonoEnv } from '../../../app-env';
import { authenticate } from '@/api/lib/effect-auth';

// Keep well below server/proxy idle timeouts so quiet streams stay open.
const HEARTBEAT_INTERVAL_MS = 15_000;

// One SSE stream per signed-in user, fed by the per-user NotificationHub
// channel. The stream is domain-agnostic: every AppNotification type rides it,
// so future notification kinds (contract updates, approval decisions, …) need
// no transport changes — publish to the hub and they arrive here.
//
// This endpoint intentionally skips the exitToResponse pattern: it never
// returns JSON on success, only a long-lived event stream. EventSource can't
// send custom headers, so auth is the same better-auth session cookie the rest
// of the API uses.
export const notificationsRoute = new Hono<HonoEnv>().get('/stream', async (c) => {
  const runtime = c.get('runtime');
  const authExit = await runtime.runPromiseExit(authenticate(c.req.raw.headers));
  if (Exit.isFailure(authExit)) {
    return c.json(
      { error: { code: 'UNAUTHORIZED' as const, message: 'Sign in to receive notifications.' } },
      401
    );
  }
  const userId = authExit.value.user.id;

  return streamSSE(c, async (stream) => {
    const pending: Array<AppNotification> = [];
    let notify = () => {};
    let open = true;
    let subscription: NotificationSubscription | null = null;

    // Registered before any awaits: hono only invokes listeners present at
    // abort time, so a client disconnecting during subscription setup must
    // already find this one — otherwise the loop below would spin forever.
    stream.onAbort(() => {
      open = false;
      notify();
    });

    try {
      subscription = await runtime.runPromise(
        NotificationHub.pipe(
          Effect.flatMap((hub) =>
            hub.subscribe(userId, (notification) => {
              pending.push(notification);
              notify();
            })
          )
        )
      );
      if (!open || stream.aborted) return;

      await stream.writeSSE({
        event: 'connected',
        data: JSON.stringify({ at: new Date().toISOString() })
      });

      while (open && !stream.aborted) {
        while (pending.length > 0) {
          const notification = pending.shift() as AppNotification;
          await stream.writeSSE({
            id: notification.id,
            event: notification.type,
            data: JSON.stringify(notification)
          });
        }
        if (!open) break;
        // Wait for the next notification or the heartbeat tick, whichever first.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, HEARTBEAT_INTERVAL_MS);
          notify = () => {
            clearTimeout(timer);
            notify = () => {};
            resolve();
          };
        });
        if (open && pending.length === 0) {
          await stream.writeSSE({ event: 'heartbeat', data: '' });
        }
      }
    } finally {
      // Sole release point — reached on abort, loop exit, and every throw.
      void subscription?.unsubscribe();
    }
  });
});
