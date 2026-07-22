import { ProviderSearchQueue } from "@repo/queue";
import { ProviderSearchOutboxRepo } from "@repo/db";
import { Effect } from "effect";

export const scheduleProviderSearchReconcile = (userId: string) =>
  Effect.all({ queue: ProviderSearchQueue, outboxRepo: ProviderSearchOutboxRepo }).pipe(
    Effect.flatMap(({ queue, outboxRepo }) =>
      outboxRepo.createPending(userId).pipe(
        Effect.flatMap((outbox) => queue.enqueueReconcile({ outboxId: outbox.id, userId })),
      )
    ),
    Effect.catchAllCause(() => {
      // TODO: log this failure to Sentry once error reporting is wired.
      return Effect.void;
    }),
    Effect.asVoid,
  );

export const scheduleProviderSearchApprovalJobs = (userId: string, expiresAt: Date) =>
  Effect.all({ queue: ProviderSearchQueue, outboxRepo: ProviderSearchOutboxRepo }).pipe(
    Effect.flatMap(({ queue, outboxRepo }) =>
      // One outbox row for the immediate reconcile; the delayed expiry job
      // gets its own row when it fires (see ReconcileProviderJob.outboxId).
      outboxRepo.createPending(userId).pipe(
        Effect.flatMap((outbox) => queue.enqueueReconcile({ outboxId: outbox.id, userId })),
        Effect.flatMap(() => queue.enqueueExpiryReconcile({ userId, expiresAt })),
      ),
    ),
    Effect.catchAllCause(() => {
      // TODO: log this failure to Sentry once error reporting is wired.
      return Effect.void;
    }),
    Effect.asVoid,
  );
