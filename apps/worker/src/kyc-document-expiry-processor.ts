import { KycDocumentRepo, ProviderSearchOutboxRepo } from '@repo/db';
import { ProviderSearchQueue } from '@repo/queue';
import { Effect } from 'effect';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back the sweep looks. Re-indexing is idempotent, so a window of a
 * week covers a worker that was down for a few days at no extra risk. */
const LOOKBACK_DAYS = 7;

const startOfUtcDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/** Same shape as the API's helper: outbox row, then the job; failures are
 * swallowed (the read path already applies expiry, see below). */
const scheduleProviderSearchReconcile = (userId: string) =>
  Effect.all({ queue: ProviderSearchQueue, outboxRepo: ProviderSearchOutboxRepo }).pipe(
    Effect.flatMap(({ queue, outboxRepo }) =>
      outboxRepo
        .createPending(userId)
        .pipe(Effect.flatMap((outbox) => queue.enqueueReconcile({ outboxId: outbox.id, userId })))
    ),
    Effect.catchAllCause(() => Effect.void),
    Effect.asVoid
  );

/**
 * Daily: re-index helpers whose approved credential has just lapsed (R9).
 *
 * Expiry is applied at read time wherever publishability is decided (a
 * document is valid through its expiry date), so this is index hygiene: the
 * search document still lists a credential-gated service until the helper is
 * re-indexed. Documents that expired before today and within the lookback
 * window are picked up.
 */
export const reconcileExpiredKycDocuments = (now: Date) =>
  Effect.gen(function* () {
    const repo = yield* KycDocumentRepo;
    const today = startOfUtcDay(now);
    const from = new Date(today.getTime() - LOOKBACK_DAYS * DAY_MS);
    const userIds = yield* repo.listUserIdsWithApprovedExpiringBetween(from, today);
    yield* Effect.forEach(userIds, scheduleProviderSearchReconcile, { concurrency: 5 });
    return { reindexed: userIds.length };
  });
