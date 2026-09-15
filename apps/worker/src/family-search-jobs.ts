import { FamilySearchOutboxRepo } from '@repo/db';
import { FamilySearchQueue } from '@repo/queue';
import { Effect } from 'effect';

/** Same shape as the API's helper: outbox row first, then the job, and any
 * failure is swallowed — the read path filters on `verifiedUntil` and
 * re-verifies in the database, so a missed reconcile is a delay, never a
 * lapsed family staying visible. */
export const scheduleFamilySearchReconcile = (userId: string) =>
  Effect.all({ queue: FamilySearchQueue, outboxRepo: FamilySearchOutboxRepo }).pipe(
    Effect.flatMap(({ queue, outboxRepo }) =>
      outboxRepo
        .createPending(userId)
        .pipe(Effect.flatMap((outbox) => queue.enqueueReconcile({ outboxId: outbox.id, userId })))
    ),
    Effect.catchAllCause(() => Effect.void),
    Effect.asVoid
  );
