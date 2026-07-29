import type { Job } from "bullmq";
import { Cause, Effect } from "effect";
import { FamilySearchIndex } from "@repo/typesense";
import { FamilySearchOutboxRepo } from "@repo/db";
import { familySearchJobNames, type ReconcileFamilyJob } from "@repo/queue";

const processReconcileFamily = (data: ReconcileFamilyJob) =>
  Effect.gen(function*() {
    const index = yield* FamilySearchIndex;
    const outboxRepo = yield* FamilySearchOutboxRepo;

    yield* outboxRepo.markProcessing(data.outboxId);
    yield* index.reconcileFamily(data.userId).pipe(
      Effect.catchAllCause((cause) =>
        outboxRepo.markFailed(data.outboxId, Cause.pretty(cause)).pipe(
          Effect.flatMap(() => Effect.failCause(cause)),
        ),
      ),
    );
    yield* outboxRepo.markProcessed(data.outboxId);
  });

const processReindexAllFamilies = () =>
  Effect.gen(function*() {
    const startedAt = new Date();
    const index = yield* FamilySearchIndex;
    const outboxRepo = yield* FamilySearchOutboxRepo;

    yield* index.reindexAllFamilies();
    yield* outboxRepo.markSupersededBefore(startedAt);
  });

export const processFamilySearchJob = (job: Pick<Job, "name" | "data">) =>
  Effect.suspend(() => {
    switch (job.name) {
      case familySearchJobNames.reconcileFamily:
        return processReconcileFamily(job.data as ReconcileFamilyJob);
      case familySearchJobNames.reindexAllFamilies:
        return processReindexAllFamilies();
      default:
        return Effect.dieMessage(`Unsupported family-search job: ${job.name}`);
    }
  });
