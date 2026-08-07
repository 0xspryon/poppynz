import { providerSearchJobNames } from '@repo/queue';
import { makeProviderSearchIndexTest } from '@repo/typesense';
import { makeProviderSearchOutboxRepoTest, type ProviderSearchOutbox } from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { processProviderSearchJob } from './provider-search-processor';

const getDieMessage = (exit: Exit.Exit<unknown, unknown>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
  const die = Cause.dieOption(exit.cause);
  if (Option.isNone(die)) throw new Error('Expected defect');
  return String(die.value);
};

const outbox = (id = 'outbox-1'): ProviderSearchOutbox => ({
  id,
  userId: 'provider-1',
  status: 'pending',
  attempts: 0,
  lastError: null,
  processedAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z')
});

const makeLayer = (
  options: {
    onReconcile?: (userId: string) => void;
    onReindex?: () => void;
  } = {}
) =>
  Layer.mergeAll(
    makeProviderSearchIndexTest({
      ensureCollection: () => Effect.void,
      reconcileProvider: (userId) => {
        options.onReconcile?.(userId);
        return Effect.void;
      },
      searchProviders: () =>
        Effect.succeed({ providers: [], pagination: { page: 1, perPage: 20, total: 0 } }),
      listCityFacets: () => Effect.succeed([]),
      getProvider: () => Effect.die('not used'),
      reindexAllProviders: () => {
        options.onReindex?.();
        return Effect.succeed({ indexed: 1, deletedStale: 0 });
      }
    }),
    makeProviderSearchOutboxRepoTest({
      createPending: () => Effect.succeed(outbox()),
      listUnresolved: () => Effect.succeed([]),
      markProcessing: (id) => Effect.succeed(outbox(id)),
      markProcessed: (id) => Effect.succeed(outbox(id)),
      markFailed: (id) => Effect.succeed(outbox(id)),
      markSupersededBefore: () => Effect.succeed(0)
    })
  );

describe('processProviderSearchJob', () => {
  it('dispatches reconcile-provider jobs', async () => {
    const onReconcile = vi.fn();

    await Effect.runPromise(
      processProviderSearchJob({
        name: providerSearchJobNames.reconcileProvider,
        data: { outboxId: 'outbox-1', userId: 'provider-1' }
      }).pipe(Effect.provide(makeLayer({ onReconcile })))
    );

    expect(onReconcile).toHaveBeenCalledWith('provider-1');
  });

  it('dispatches reindex-all-providers jobs', async () => {
    const onReindex = vi.fn();

    await Effect.runPromise(
      processProviderSearchJob({
        name: providerSearchJobNames.reindexAllProviders,
        data: {}
      }).pipe(Effect.provide(makeLayer({ onReindex })))
    );

    expect(onReindex).toHaveBeenCalledOnce();
  });

  it('dies for unsupported jobs so BullMQ marks the job failed', async () => {
    const exit = await Effect.runPromise(
      processProviderSearchJob({ name: 'unknown-job', data: {} }).pipe(
        Effect.provide(makeLayer()),
        Effect.exit
      )
    );

    expect(getDieMessage(exit)).toContain('Unsupported provider-search job: unknown-job');
  });
});
