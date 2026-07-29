import { familySearchJobNames } from "@repo/queue";
import { makeFamilySearchIndexTest } from "@repo/typesense";
import { makeFamilySearchOutboxRepoTest, type FamilySearchOutbox } from "@repo/db";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { processFamilySearchJob } from "./family-search-processor";

const getDieMessage = (exit: Exit.Exit<unknown, unknown>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected effect to fail");
  const die = Cause.dieOption(exit.cause);
  if (Option.isNone(die)) throw new Error("Expected defect");
  return String(die.value);
};

const outbox = (id = "outbox-1"): FamilySearchOutbox => ({
  id,
  userId: "family-1",
  status: "pending",
  attempts: 0,
  lastError: null,
  processedAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
});

const makeLayer = (options: {
  onReconcile?: (userId: string) => void;
  onReindex?: () => void;
} = {}) =>
  Layer.mergeAll(
    makeFamilySearchIndexTest({
      ensureCollection: () => Effect.void,
      reconcileFamily: (userId) => {
        options.onReconcile?.(userId);
        return Effect.void;
      },
      searchFamilies: () => Effect.succeed({ families: [], pagination: { page: 1, perPage: 20, total: 0 } }),
      listCityFacets: () => Effect.succeed([]),
      getFamily: () => Effect.die("not used"),
      reindexAllFamilies: () => {
        options.onReindex?.();
        return Effect.succeed({ indexed: 1, deletedStale: 0 });
      },
    }),
    makeFamilySearchOutboxRepoTest({
      createPending: () => Effect.succeed(outbox()),
      listUnresolved: () => Effect.succeed([]),
      markProcessing: (id) => Effect.succeed(outbox(id)),
      markProcessed: (id) => Effect.succeed(outbox(id)),
      markFailed: (id) => Effect.succeed(outbox(id)),
      markSupersededBefore: () => Effect.succeed(0),
    }),
  );

describe("processFamilySearchJob", () => {
  it("dispatches reconcile-family jobs", async () => {
    const onReconcile = vi.fn();

    await Effect.runPromise(
      processFamilySearchJob({
        name: familySearchJobNames.reconcileFamily,
        data: { outboxId: "outbox-1", userId: "family-1" },
      }).pipe(Effect.provide(makeLayer({ onReconcile }))),
    );

    expect(onReconcile).toHaveBeenCalledWith("family-1");
  });

  it("dispatches reindex-all-families jobs", async () => {
    const onReindex = vi.fn();

    await Effect.runPromise(
      processFamilySearchJob({
        name: familySearchJobNames.reindexAllFamilies,
        data: {},
      }).pipe(Effect.provide(makeLayer({ onReindex }))),
    );

    expect(onReindex).toHaveBeenCalledOnce();
  });

  it("dies for unsupported jobs so BullMQ marks the job failed", async () => {
    const exit = await Effect.runPromise(
      processFamilySearchJob({ name: "unknown-job", data: {} }).pipe(
        Effect.provide(makeLayer()),
        Effect.exit,
      ),
    );

    expect(getDieMessage(exit)).toContain("Unsupported family-search job: unknown-job");
  });
});
