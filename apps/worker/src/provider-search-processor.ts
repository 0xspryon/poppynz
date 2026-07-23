import type { Job } from "bullmq";
import { Cause, Effect } from "effect";
import { ProviderSearchIndex } from "@repo/typesense";
import { ProviderSearchOutboxRepo } from "@repo/db";
import { providerSearchJobNames, type ReconcileProviderJob } from "@repo/queue";

const processReconcileProvider = (data: ReconcileProviderJob) =>
  Effect.gen(function*() {
    const index = yield* ProviderSearchIndex;
    const outboxRepo = yield* ProviderSearchOutboxRepo;

    // Delayed expiry jobs carry no outbox row (it would sit unresolved for
    // the whole approval lifetime) — create the audit row when the job fires.
    const outboxId = data.outboxId ?? (yield* outboxRepo.createPending(data.userId)).id;

    yield* outboxRepo.markProcessing(outboxId);
    yield* index.reconcileProvider(data.userId).pipe(
      Effect.catchAllCause((cause) =>
        outboxRepo.markFailed(outboxId, Cause.pretty(cause)).pipe(
          Effect.flatMap(() => Effect.failCause(cause)),
        ),
      ),
    );
    yield* outboxRepo.markProcessed(outboxId);
  });

const processReindexAllProviders = () =>
  Effect.gen(function*() {
    const startedAt = new Date();
    const index = yield* ProviderSearchIndex;
    const outboxRepo = yield* ProviderSearchOutboxRepo;

    yield* index.reindexAllProviders();
    yield* outboxRepo.markSupersededBefore(startedAt);
  });

export const processProviderSearchJob = (job: Pick<Job, "name" | "data">) =>
  Effect.suspend(() => {
    switch (job.name) {
      case providerSearchJobNames.reconcileProvider:
        return processReconcileProvider(job.data as ReconcileProviderJob);
      case providerSearchJobNames.reindexAllProviders:
        return processReindexAllProviders();
      default:
        return Effect.dieMessage(`Unsupported provider-search job: ${job.name}`);
    }
  });
