import {
  EmptyKycDocumentRepoTest,
  KycDocumentRepo,
  makeKycDocumentRepoTest,
  makeProviderSearchOutboxRepoTest,
  type ProviderSearchOutbox
} from '@repo/db';
import { makeProviderSearchQueueTest } from '@repo/queue';
import { Context, Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { reconcileExpiredKycDocuments } from './kyc-document-expiry-processor';

const emptyRepo = Effect.runSync(KycDocumentRepo.pipe(Effect.provide(EmptyKycDocumentRepoTest)));

describe('reconcileExpiredKycDocuments (R9)', () => {
  it('re-indexes helpers whose approved document expired in the lookback window', async () => {
    const windows: Array<[string, string]> = [];
    const enqueued: Array<string> = [];
    const layer = Layer.mergeAll(
      makeKycDocumentRepoTest({
        ...(emptyRepo as Context.Tag.Service<KycDocumentRepo>),
        listUserIdsWithApprovedExpiringBetween: (from, to) => {
          windows.push([from.toISOString(), to.toISOString()]);
          return Effect.succeed(['helper-1', 'helper-2']);
        }
      }),
      makeProviderSearchOutboxRepoTest({
        createPending: (userId) =>
          Effect.succeed({ id: `outbox-${userId}`, userId } as unknown as ProviderSearchOutbox)
      } as never),
      makeProviderSearchQueueTest({
        enqueueReconcile: (job) => {
          enqueued.push(job.userId);
          return Effect.void;
        }
      } as never)
    );
    const result = await Effect.runPromise(
      reconcileExpiredKycDocuments(new Date('2026-10-24T02:00:00.000Z')).pipe(Effect.provide(layer))
    );
    expect(result).toEqual({ reindexed: 2 });
    // Valid through the expiry day: today is excluded, the last week included.
    expect(windows).toEqual([['2026-10-17T00:00:00.000Z', '2026-10-24T00:00:00.000Z']]);
    expect(enqueued.sort()).toEqual(['helper-1', 'helper-2']);
  });
});
