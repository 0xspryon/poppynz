import type { Job } from "bullmq";
import { Effect } from "effect";
import { ProviderSearchIndex } from "@repo/typesense";
import { providerSearchJobNames, type ReconcileProviderJob } from "@repo/queue";

export const processProviderSearchJob = (job: Pick<Job, "name" | "data">) =>
  ProviderSearchIndex.pipe(
    Effect.flatMap((index) => {
      switch (job.name) {
        case providerSearchJobNames.reconcileProvider: {
          const data = job.data as ReconcileProviderJob;
          return index.reconcileProvider(data.userId);
        }
        case providerSearchJobNames.reindexAllProviders:
          return index.reindexAllProviders().pipe(Effect.asVoid);
        default:
          return Effect.dieMessage(`Unsupported provider-search job: ${job.name}`);
      }
    }),
  );
