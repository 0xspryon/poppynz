import { redisConfig } from "@repo/env";
import { Queue, type JobsOptions, type QueueOptions } from "bullmq";
import { Context, Data, Effect, Layer } from "effect";

export const providerSearchQueueDefinition = {
  name: "provider-search" as const,
  displayName: "Provider Search" as const,
  type: "bullmq" as const,
};

export const queues = [providerSearchQueueDefinition] as const;

export const providerSearchJobNames = {
  reconcileProvider: "reconcile-provider",
  reindexAllProviders: "reindex-all-providers",
} as const;

export type ReconcileProviderJob = { outboxId: string; userId: string };
export type ReindexAllProvidersJob = Record<string, never>;
export type ProviderSearchJobData = ReconcileProviderJob | ReindexAllProvidersJob;

export type EnqueuedJob = {
  id: string | undefined;
  name: string;
};

const providerSearchExpiryJobId = (userId: string, expiresAt: Date) => `provider-search-expiry-${userId}-${expiresAt.getTime()}`;
const providerSearchReconcileDeduplicationId = (userId: string) => `provider-search-reconcile-${userId}`;
const providerSearchReindexDeduplicationId = "provider-search-reindex";

export class ProviderSearchQueueError extends Data.TaggedError("ProviderSearchQueueError")<{
  operation: "enqueueReconcile" | "enqueueExpiryReconcile" | "enqueueReindex";
  cause: unknown;
}> { }

const parseRedisUrl = (url: string): QueueOptions["connection"] => {
  const parsed = new URL(url);

  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
  };
};

export const redisConnectionConfig = redisConfig.pipe(Effect.map((config) => parseRedisUrl(config.url)));

export const getRedisConnection = (): QueueOptions["connection"] =>
  Effect.runSync(redisConnectionConfig);

const defaultJobOptions: JobsOptions = {
  attempts: 10,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800, count: 5_000 },
};

export const makeProviderSearchQueue = (connection: QueueOptions["connection"]) =>
  new Queue<ProviderSearchJobData>(providerSearchQueueDefinition.name, {
    connection,
    defaultJobOptions,
  });

export class ProviderSearchQueue extends Context.Tag("@repo/queue/ProviderSearchQueue")<
  ProviderSearchQueue,
  {
    enqueueReconcile: (input: ReconcileProviderJob) => Effect.Effect<EnqueuedJob, ProviderSearchQueueError>;
    enqueueExpiryReconcile: (input: ReconcileProviderJob & { expiresAt: Date }) => Effect.Effect<EnqueuedJob, ProviderSearchQueueError>;
    enqueueReindex: () => Effect.Effect<EnqueuedJob, ProviderSearchQueueError>;
  }
>() { }

export const ProviderSearchQueueLive = Layer.effect(ProviderSearchQueue, redisConnectionConfig.pipe(Effect.map((connection) => {
  const queue = makeProviderSearchQueue(connection);

  return {
    enqueueReconcile: (input) =>
      Effect.tryPromise({
        try: async () => {
          const job = await queue.add(
            providerSearchJobNames.reconcileProvider,
            { outboxId: input.outboxId, userId: input.userId },
            { deduplication: { id: providerSearchReconcileDeduplicationId(input.userId) } },
          );

          return { id: job.id, name: job.name };
        },
        catch: (cause) => new ProviderSearchQueueError({ operation: "enqueueReconcile", cause }),
      }),
    enqueueExpiryReconcile: (input) =>
      Effect.tryPromise({
        try: async () => {
          const ONE_MINUTE_MILLIS = 1 * 60 * 1000;
          const delay = Math.max(ONE_MINUTE_MILLIS, input.expiresAt.getTime() - Date.now());
          const job = await queue.add(
            providerSearchJobNames.reconcileProvider,
            { outboxId: input.outboxId, userId: input.userId },
            {
              deduplication: {
                id: providerSearchExpiryJobId(input.userId, input.expiresAt)
              },
              delay
            },
          );

          return { id: job.id, name: job.name };
        },
        catch: (cause) => new ProviderSearchQueueError(
          { operation: "enqueueExpiryReconcile", cause }
        ),
      }),
    enqueueReindex: () =>
      Effect.tryPromise({
        try: async () => {
          const job = await queue.add(
            providerSearchJobNames.reindexAllProviders,
            {},
            { deduplication: { id: providerSearchReindexDeduplicationId } },
          );

          return { id: job.id, name: job.name };
        },
        catch: (cause) => new ProviderSearchQueueError({ operation: "enqueueReindex", cause }),
      }),
  };
})));

export const makeProviderSearchQueueTest = (implementation: Context.Tag.Service<ProviderSearchQueue>) =>
  Layer.succeed(ProviderSearchQueue, implementation);
