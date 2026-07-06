import type { Job } from "bullmq";
import { Cause, Effect } from "effect";
import { ProviderSearchIndex } from "@repo/typesense";
import { ProviderSearchOutboxRepo } from "@repo/db";
import { providerSearchJobNames, type ReconcileProviderJob } from "@repo/queue";

const processReconcileProvider = (data: ReconcileProviderJob) =>
  Effect.gen(function*() {
    const index = yield* ProviderSearchIndex;
    const outboxRepo = yield* ProviderSearchOutboxRepo;

    yield* outboxRepo.markProcessing(data.outboxId);
    yield* index.reconcileProvider(data.userId).pipe(
      Effect.catchAllCause((cause) =>
        outboxRepo.markFailed(data.outboxId, Cause.pretty(cause)).pipe(
          Effect.flatMap(() => Effect.failCause(cause)),
        ),
      ),
    );
    yield* outboxRepo.markProcessed(data.outboxId);
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
