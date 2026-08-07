import { redisConfig } from "@repo/env";
import { Context, Data, Effect, Layer } from "effect";
import { Redis } from "ioredis";
import type { AppNotification, NotificationInput } from "./events";

export * from "./events";

// Per-user realtime notification hub, backed by Redis pub/sub so it stays
// correct when the API runs more than one instance: publishes go to Redis and
// every instance's subscribers see them, wherever the SSE connection lives.

export class NotificationPublishError extends Data.TaggedError("NotificationPublishError")<{
  cause: unknown;
}> { }

export class NotificationSubscribeError extends Data.TaggedError("NotificationSubscribeError")<{
  cause: unknown;
}> { }

export type NotificationSubscription = {
  unsubscribe: () => Promise<void>;
};

export class NotificationHub extends Context.Tag("@repo/notify/NotificationHub")<
  NotificationHub,
  {
    publish: (userId: string, input: NotificationInput) => Effect.Effect<void, NotificationPublishError>;
    subscribe: (
      userId: string,
      onNotification: (notification: AppNotification) => void,
    ) => Effect.Effect<NotificationSubscription, NotificationSubscribeError>;
  }
>() { }

const userChannel = (userId: string) => `notify:user:${userId}`;

export const makeNotificationHub = (redisUrl: string): Context.Tag.Service<NotificationHub> => {
  // Lazily created so merely constructing the layer (e.g. in tests that never
  // touch the hub) opens no connections. A Redis connection in subscriber mode
  // accepts no other commands, hence the dedicated second client.
  let publisher: Redis | null = null;
  let subscriber: Redis | null = null;
  const handlers = new Map<string, Set<(notification: AppNotification) => void>>();

  const getPublisher = () => (publisher ??= new Redis(redisUrl));

  const getSubscriber = () => {
    if (subscriber) return subscriber;
    subscriber = new Redis(redisUrl);
    subscriber.on("message", (channel: string, raw: string) => {
      const channelHandlers = handlers.get(channel);
      if (!channelHandlers || channelHandlers.size === 0) return;
      let notification: AppNotification;
      try {
        notification = JSON.parse(raw) as AppNotification;
      } catch {
        return;
      }
      for (const handler of channelHandlers) handler(notification);
    });
    return subscriber;
  };

  return {
    publish: (userId, input) =>
      Effect.tryPromise({
        try: async () => {
          const notification: AppNotification = {
            id: crypto.randomUUID(),
            type: input.type,
            createdAt: new Date().toISOString(),
            payload: input.payload,
          } as AppNotification;
          await getPublisher().publish(userChannel(userId), JSON.stringify(notification));
        },
        catch: (cause) => new NotificationPublishError({ cause }),
      }).pipe(Effect.asVoid),
    subscribe: (userId, onNotification) =>
      Effect.tryPromise({
        try: async () => {
          const channel = userChannel(userId);
          const redis = getSubscriber();
          let channelHandlers = handlers.get(channel);
          if (!channelHandlers) {
            // Subscribe in Redis BEFORE registering anything locally: if this
            // rejects, no half-registered handler is left behind to make every
            // future subscribe skip the (then-missing) Redis subscription.
            // A concurrent first-subscriber may have registered during the
            // await, so re-check before creating the set (double SUBSCRIBE is
            // harmless — Redis dedupes per connection).
            await redis.subscribe(channel);
            channelHandlers = handlers.get(channel);
            if (!channelHandlers) {
              channelHandlers = new Set();
              handlers.set(channel, channelHandlers);
            }
          }
          channelHandlers.add(onNotification);

          return {
            unsubscribe: async () => {
              const current = handlers.get(channel);
              if (!current) return;
              current.delete(onNotification);
              if (current.size === 0) {
                handlers.delete(channel);
                await redis.unsubscribe(channel);
              }
            },
          };
        },
        catch: (cause) => new NotificationSubscribeError({ cause }),
      }),
  };
};

export const NotificationHubLive = Layer.effect(
  NotificationHub,
  redisConfig.pipe(Effect.map((config) => makeNotificationHub(config.url))),
);

export const makeNotificationHubTest = (implementation: Context.Tag.Service<NotificationHub>) =>
  Layer.succeed(NotificationHub, implementation);

export const NoopNotificationHubTest = makeNotificationHubTest({
  publish: () => Effect.void,
  subscribe: () => Effect.succeed({ unsubscribe: async () => { } }),
});

/** Realtime notifications are an accelerator, never a source of truth: losing
 * one must not fail the mutation that triggered it, so publish failures are
 * logged and swallowed (mirrors sendMailBestEffort). */
export const publishNotificationBestEffort = (userId: string, input: NotificationInput) =>
  NotificationHub.pipe(
    Effect.flatMap((hub) => hub.publish(userId, input)),
    Effect.catchAllCause((cause) => Effect.logWarning("notification publish failed", cause)),
    Effect.asVoid,
  );
