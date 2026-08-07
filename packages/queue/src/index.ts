import { redisConfig } from '@repo/env';
import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';
import { Context, Data, Effect, Layer } from 'effect';

export const providerSearchQueueDefinition = {
  name: 'provider-search' as const,
  displayName: 'Provider Search' as const,
  type: 'bullmq' as const
};

export const approvalExpiryQueueDefinition = {
  name: 'approval-expiry' as const,
  displayName: 'Approval Expiry' as const,
  type: 'bullmq' as const
};

export const familySearchQueueDefinition = {
  name: 'family-search' as const,
  displayName: 'Family Search' as const,
  type: 'bullmq' as const
};

export const queues = [
  providerSearchQueueDefinition,
  familySearchQueueDefinition,
  approvalExpiryQueueDefinition
] as const;

export const providerSearchJobNames = {
  reconcileProvider: 'reconcile-provider',
  reindexAllProviders: 'reindex-all-providers'
} as const;

export const familySearchJobNames = {
  reconcileFamily: 'reconcile-family',
  reindexAllFamilies: 'reindex-all-families'
} as const;

export const approvalExpiryJobNames = {
  notifyExpiring: 'notify-expiring-approvals'
} as const;

/** One repeatable scheduler drives the daily run; upserted on worker boot. */
export const approvalExpirySchedulerId = 'approval-expiry-daily';
export const approvalExpiryCronPattern = '0 2 * * *';

// outboxId stays nullable only for legacy delayed expiry jobs still sitting
// in Redis from before expiry reconciles were dropped (search-time DB
// verification made them redundant) — the worker creates the outbox row when
// such a job fires. New enqueues always carry an outbox id.
export type ReconcileProviderJob = { outboxId: string | null; userId: string };
export type ReindexAllProvidersJob = Record<string, never>;
export type ProviderSearchJobData = ReconcileProviderJob | ReindexAllProvidersJob;

// Family reconciles have no legacy delayed jobs, so every enqueue carries its
// outbox row id.
export type ReconcileFamilyJob = { outboxId: string; userId: string };
export type ReindexAllFamiliesJob = Record<string, never>;
export type FamilySearchJobData = ReconcileFamilyJob | ReindexAllFamiliesJob;

export type EnqueuedJob = {
  id: string | undefined;
  name: string;
};

const providerSearchReconcileDeduplicationId = (userId: string) =>
  `provider-search-reconcile-${userId}`;
const providerSearchReindexDeduplicationId = 'provider-search-reindex';

export const familySearchReconcileDeduplicationId = (userId: string) =>
  `family-search-reconcile-${userId}`;
const familySearchReindexDeduplicationId = 'family-search-reindex';

export class ProviderSearchQueueError extends Data.TaggedError('ProviderSearchQueueError')<{
  operation: 'enqueueReconcile' | 'enqueueReindex';
  cause: unknown;
}> {}

export class FamilySearchQueueError extends Data.TaggedError('FamilySearchQueueError')<{
  operation: 'enqueueReconcile' | 'enqueueReindex';
  cause: unknown;
}> {}

const parseRedisUrl = (url: string): QueueOptions['connection'] => {
  const parsed = new URL(url);

  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined
  };
};

export const redisConnectionConfig = redisConfig.pipe(
  Effect.map((config) => parseRedisUrl(config.url))
);

export const getRedisConnection = (): QueueOptions['connection'] =>
  Effect.runSync(redisConnectionConfig);

const defaultJobOptions: JobsOptions = {
  attempts: 10,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800, count: 5_000 }
};

export const makeProviderSearchQueue = (connection: QueueOptions['connection']) =>
  new Queue<ProviderSearchJobData>(providerSearchQueueDefinition.name, {
    connection,
    defaultJobOptions
  });

export class ProviderSearchQueue extends Context.Tag('@repo/queue/ProviderSearchQueue')<
  ProviderSearchQueue,
  {
    enqueueReconcile: (
      input: ReconcileProviderJob
    ) => Effect.Effect<EnqueuedJob, ProviderSearchQueueError>;
    enqueueReindex: () => Effect.Effect<EnqueuedJob, ProviderSearchQueueError>;
  }
>() {}

export const ProviderSearchQueueLive = Layer.effect(
  ProviderSearchQueue,
  redisConnectionConfig.pipe(
    Effect.map((connection) => {
      const queue = makeProviderSearchQueue(connection);

      return {
        enqueueReconcile: (input: ReconcileProviderJob) =>
          Effect.tryPromise({
            try: async () => {
              const job = await queue.add(
                providerSearchJobNames.reconcileProvider,
                { outboxId: input.outboxId, userId: input.userId },
                { deduplication: { id: providerSearchReconcileDeduplicationId(input.userId) } }
              );

              return { id: job.id, name: job.name };
            },
            catch: (cause) => new ProviderSearchQueueError({ operation: 'enqueueReconcile', cause })
          }),
        enqueueReindex: () =>
          Effect.tryPromise({
            try: async () => {
              const job = await queue.add(
                providerSearchJobNames.reindexAllProviders,
                {},
                { deduplication: { id: providerSearchReindexDeduplicationId } }
              );

              return { id: job.id, name: job.name };
            },
            catch: (cause) => new ProviderSearchQueueError({ operation: 'enqueueReindex', cause })
          })
      };
    })
  )
);

export const makeProviderSearchQueueTest = (
  implementation: Context.Tag.Service<ProviderSearchQueue>
) => Layer.succeed(ProviderSearchQueue, implementation);

export const makeFamilySearchQueue = (connection: QueueOptions['connection']) =>
  new Queue<FamilySearchJobData>(familySearchQueueDefinition.name, {
    connection,
    defaultJobOptions
  });

export class FamilySearchQueue extends Context.Tag('@repo/queue/FamilySearchQueue')<
  FamilySearchQueue,
  {
    enqueueReconcile: (
      input: ReconcileFamilyJob
    ) => Effect.Effect<EnqueuedJob, FamilySearchQueueError>;
    enqueueReindex: () => Effect.Effect<EnqueuedJob, FamilySearchQueueError>;
  }
>() {}

export const FamilySearchQueueLive = Layer.effect(
  FamilySearchQueue,
  redisConnectionConfig.pipe(
    Effect.map((connection) => {
      const queue = makeFamilySearchQueue(connection);

      return {
        enqueueReconcile: (input: ReconcileFamilyJob) =>
          Effect.tryPromise({
            try: async () => {
              const job = await queue.add(
                familySearchJobNames.reconcileFamily,
                { outboxId: input.outboxId, userId: input.userId },
                { deduplication: { id: familySearchReconcileDeduplicationId(input.userId) } }
              );

              return { id: job.id, name: job.name };
            },
            catch: (cause) => new FamilySearchQueueError({ operation: 'enqueueReconcile', cause })
          }),
        enqueueReindex: () =>
          Effect.tryPromise({
            try: async () => {
              const job = await queue.add(
                familySearchJobNames.reindexAllFamilies,
                {},
                { deduplication: { id: familySearchReindexDeduplicationId } }
              );

              return { id: job.id, name: job.name };
            },
            catch: (cause) => new FamilySearchQueueError({ operation: 'enqueueReindex', cause })
          })
      };
    })
  )
);

export const makeFamilySearchQueueTest = (implementation: Context.Tag.Service<FamilySearchQueue>) =>
  Layer.succeed(FamilySearchQueue, implementation);
