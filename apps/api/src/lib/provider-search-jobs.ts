import { ProviderSearchQueue } from "@repo/queue";
import { Effect } from "effect";

export const scheduleProviderSearchReconcile = (userId: string) =>
  ProviderSearchQueue.pipe(
    Effect.flatMap((queue) => queue.enqueueReconcile(userId)),
    Effect.catchAllCause(() => {
      // TODO: log this failure to Sentry once error reporting is wired.
      return Effect.void;
    }),
    Effect.asVoid,
  );

export const scheduleProviderSearchApprovalJobs = (userId: string, expiresAt: Date) =>
  ProviderSearchQueue.pipe(
    Effect.flatMap((queue) =>
      Effect.all([
        queue.enqueueReconcile(userId),
        queue.enqueueExpiryReconcile(userId, expiresAt),
      ], { concurrency: "unbounded" }),
    ),
    Effect.catchAllCause(() => {
      // TODO: log this failure to Sentry once error reporting is wired.
      return Effect.void;
    }),
    Effect.asVoid,
  );
