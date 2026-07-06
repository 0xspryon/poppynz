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
      Effect.all([
        outboxRepo.createPending(userId).pipe(
          Effect.flatMap((outbox) => queue.enqueueReconcile({ outboxId: outbox.id, userId })),
        ),
        outboxRepo.createPending(userId).pipe(
          Effect.flatMap((outbox) => queue.enqueueExpiryReconcile({ outboxId: outbox.id, userId, expiresAt })),
        ),
      ], { concurrency: "unbounded" }),
    ),
    Effect.catchAllCause(() => {
      // TODO: log this failure to Sentry once error reporting is wired.
      return Effect.void;
    }),
    Effect.asVoid,
  );
