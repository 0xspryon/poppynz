import { FamilySearchQueue } from '@repo/queue';
import { FamilySearchOutboxRepo } from '@repo/db';
import { Effect } from 'effect';

export const scheduleFamilySearchReconcile = (userId: string) =>
  Effect.all({ queue: FamilySearchQueue, outboxRepo: FamilySearchOutboxRepo }).pipe(
    Effect.flatMap(({ queue, outboxRepo }) =>
      outboxRepo
        .createPending(userId)
        .pipe(Effect.flatMap((outbox) => queue.enqueueReconcile({ outboxId: outbox.id, userId })))
    ),
    Effect.catchAllCause(() => {
      // TODO: log this failure to Sentry once error reporting is wired.
      return Effect.void;
    }),
    Effect.asVoid
  );
