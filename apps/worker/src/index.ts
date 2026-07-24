import express from "express";
import { createQueueDashExpressMiddleware } from "@queuedash/api";
import { Queue, Worker } from "bullmq";
import { Effect, Layer, ManagedRuntime } from "effect";
import { trustedOriginsConfig } from "@repo/env";
import { MailerLive } from "@repo/mail";
import { ProviderSearchIndexDefault } from "@repo/typesense";
import { ApprovalRepoDefault, ProviderSearchOutboxRepo, ProviderSearchOutboxRepoDefault } from "@repo/db";
import {
  approvalExpiryCronPattern,
  approvalExpiryJobNames,
  approvalExpiryQueueDefinition,
  approvalExpirySchedulerId,
  getRedisConnection,
  providerSearchJobNames,
  providerSearchQueueDefinition,
  queues,
} from "@repo/queue";
import { processApprovalExpiryNotifications } from "./approval-expiry-processor";
import { processProviderSearchJob } from "./provider-search-processor";

const WorkerLive = Layer.mergeAll(
  ProviderSearchIndexDefault,
  ProviderSearchOutboxRepoDefault,
  ApprovalRepoDefault,
  MailerLive,
);
const runtime = ManagedRuntime.make(WorkerLive);
const connection = getRedisConnection();

// Expiry mails link back to the primary UI (first trusted origin).
const uiOrigin = Effect.runSync(trustedOriginsConfig)
  .trustedOrigins.split(";")[0]!.trim().replace(/\/$/, "");

const providerSearchWorker = new Worker(
  providerSearchQueueDefinition.name,
  async (job) => {
    await runtime.runPromise(processProviderSearchJob(job));
  },
  {
    connection,
    concurrency: Number.parseInt(process.env.PROVIDER_SEARCH_WORKER_CONCURRENCY ?? "5", 10),
  },
);

const approvalExpiryWorker = new Worker(
  approvalExpiryQueueDefinition.name,
  async () => {
    const summary = await runtime.runPromise(
      processApprovalExpiryNotifications(new Date(), uiOrigin),
    );
    console.log(
      `approval-expiry sweep: ${summary.notified} notified, ${summary.skipped} skipped, ${summary.failed} failed of ${summary.candidates} candidates`,
    );
  },
  { connection, concurrency: 1 },
);

const approvalExpiryQueue = new Queue(approvalExpiryQueueDefinition.name, { connection });

// Repeatable daily sweep at 02:00 (server timezone). Upsert is idempotent
// across worker restarts and updates the schedule if the pattern changes.
const scheduleApprovalExpirySweep = async () => {
  await approvalExpiryQueue.upsertJobScheduler(
    approvalExpirySchedulerId,
    { pattern: approvalExpiryCronPattern },
    { name: approvalExpiryJobNames.notifyExpiring, data: {} },
  );
};

void scheduleApprovalExpirySweep().catch((cause) => {
  // TODO: log this failure to Sentry once error reporting is wired.
  console.error(cause);
});

const queueDashQueues = queues.map((queue) => ({
  queue: new Queue(queue.name, { connection }),
  displayName: queue.displayName,
  type: queue.type,
}));

const providerSearchQueue = new Queue(providerSearchQueueDefinition.name, { connection });

const enqueueUnresolvedOutboxRows = async () => {
  const rows = await runtime.runPromise(
    ProviderSearchOutboxRepo.pipe(
      Effect.flatMap((repo) => repo.listUnresolved(1_000)),
    ),
  );

  await Promise.all(rows.map((row) =>
    providerSearchQueue.add(
      providerSearchJobNames.reconcileProvider,
      { outboxId: row.id, userId: row.userId },
      { deduplication: { id: `provider-search-reconcile-${row.userId}` } },
    ),
  ));
};

void enqueueUnresolvedOutboxRows().catch((cause) => {
  // TODO: log this failure to Sentry once error reporting is wired.
  console.error(cause);
});

const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/queues", (req, res, next) => {
  const username = process.env.QUEUE_UI_USERNAME;
  const password = process.env.QUEUE_UI_PASSWORD;

  if (!username || !password) return next();

  const header = req.headers.authorization;
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  if (header === expected) return next();

  res.setHeader("WWW-Authenticate", "Basic realm=\"Queue UI\"");
  res.status(401).send("Unauthorized");
});

app.use(
  "/queues",
  createQueueDashExpressMiddleware({
    ctx: { queues: queueDashQueues },
  }),
);

const port = Number.parseInt(process.env.WORKER_HTTP_PORT ?? "3001", 10);
const server = app.listen(port, () => {
  console.log(`Worker HTTP server listening on ${port}`);
});

const shutdown = async () => {
  server.close();
  await providerSearchWorker.close();
  await providerSearchQueue.close();
  await approvalExpiryWorker.close();
  await approvalExpiryQueue.close();
  await Promise.all(queueDashQueues.map(({ queue }) => queue.close()));
  await runtime.dispose();
};

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
