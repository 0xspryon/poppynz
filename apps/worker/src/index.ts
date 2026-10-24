import express from 'express';
import { createQueueDashExpressMiddleware } from '@queuedash/api';
import { Queue, Worker } from 'bullmq';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { trustedOriginsConfig } from '@repo/env';
import { CredibledDefault } from '@repo/credibled';
import { MailerLive } from '@repo/mail';
import { NotificationHubLive } from '@repo/notify';
import { PaymentsLive } from '@repo/payments';
import { ContractBillingBaseLive, withCycleSettlement } from './billing-layer';
import { describeTick, processContractBillingTick } from './contract-billing-processor';
import { FamilySearchIndexDefault, ProviderSearchIndexDefault } from '@repo/typesense';
import {
  ApprovalRepoDefault,
  BillingCustomerRepoDefault,
  CheckOrderRepoDefault,
  FamilySearchOutboxRepo,
  FamilySearchOutboxRepoDefault,
  PaymentRepoDefault,
  ProviderSearchOutboxRepo,
  ProviderSearchOutboxRepoDefault,
  SafetyVerificationRepoDefault,
  UserRepoDefault
} from '@repo/db';
import {
  FamilySearchQueueLive,
  SafetyVerificationQueueLive,
  approvalExpiryCronPattern,
  approvalExpiryJobNames,
  approvalExpiryQueueDefinition,
  approvalExpirySchedulerId,
  contractBillingCronPattern,
  contractBillingJobNames,
  contractBillingQueueDefinition,
  contractBillingSchedulerId,
  familySearchJobNames,
  familySearchQueueDefinition,
  familySearchReindexDeduplicationId,
  getRedisConnection,
  paymentRecoverySchedulerId,
  providerSearchJobNames,
  providerSearchQueueDefinition,
  providerSearchReindexDeduplicationId,
  queues,
  safetyVerificationExpiryCronPattern,
  safetyVerificationExpirySchedulerId,
  safetyVerificationJobNames,
  safetyVerificationQueueDefinition,
  safetyVerificationReconcileCronPattern,
  safetyVerificationReconcileSchedulerId,
  type PlaceCheckOrderJob
} from '@repo/queue';
import { processApprovalExpiryNotifications } from './approval-expiry-processor';
import { processFamilySearchJob } from './family-search-processor';
import { recoverPendingPayments } from './payment-recovery-processor';
import { processProviderSearchJob } from './provider-search-processor';
import { processSafetyVerificationExpiries } from './safety-verification-expiry-processor';
import { placeCheckOrder, recoverUnplacedCheckOrders } from './safety-verification-order-processor';
import { reconcileCheckOrderStatuses } from './safety-verification-status-processor';

const WorkerBaseLive = Layer.mergeAll(
  // Contract billing (piece 3): repos, provider, mail and notifications.
  ContractBillingBaseLive,
  ProviderSearchIndexDefault,
  ProviderSearchOutboxRepoDefault,
  FamilySearchIndexDefault,
  FamilySearchOutboxRepoDefault,
  ApprovalRepoDefault,
  SafetyVerificationRepoDefault,
  CheckOrderRepoDefault,
  PaymentRepoDefault,
  // Settling a family's first payment saves its card.
  BillingCustomerRepoDefault,
  UserRepoDefault,
  CredibledDefault,
  // Same PAYMENTS_PROVIDER switch as the API (default `mock`).
  PaymentsLive,
  // A payment the recovery job settles hands its order to the place-order
  // job, exactly as the API's settle does.
  SafetyVerificationQueueLive,
  MailerLive,
  // The expiry sweep re-indexes a family whose verification lapsed.
  FamilySearchQueueLive,
  // Check-order transitions publish to the same Redis channels the API's SSE
  // stream subscribes to, so the applicant's page learns without a refresh.
  NotificationHubLive
);
// Contract-cycle payments settle through the one settle path (the recovery
// job included) with contract billing's own dependencies.
const WorkerLive = withCycleSettlement(WorkerBaseLive);
const runtime = ManagedRuntime.make(WorkerLive);
const connection = getRedisConnection();

// Expiry mails link back to the primary UI (first trusted origin).
const uiOrigin = Effect.runSync(trustedOriginsConfig)
  .trustedOrigins.split(';')[0]!
  .trim()
  .replace(/\/$/, '');

const providerSearchWorker = new Worker(
  providerSearchQueueDefinition.name,
  async (job) => {
    await runtime.runPromise(processProviderSearchJob(job));
  },
  {
    connection,
    concurrency: Number.parseInt(process.env.PROVIDER_SEARCH_WORKER_CONCURRENCY ?? '5', 10)
  }
);

const familySearchWorker = new Worker(
  familySearchQueueDefinition.name,
  async (job) => {
    await runtime.runPromise(processFamilySearchJob(job));
  },
  {
    connection,
    concurrency: Number.parseInt(process.env.FAMILY_SEARCH_WORKER_CONCURRENCY ?? '5', 10)
  }
);

const safetyVerificationWorker = new Worker(
  safetyVerificationQueueDefinition.name,
  async (job) => {
    if (job.name === safetyVerificationJobNames.placeOrder) {
      const data = job.data as PlaceCheckOrderJob;
      const outcome = await runtime.runPromise(placeCheckOrder(data.orderId));
      console.log(`safety-verification order: ${outcome}`);
      return;
    }

    if (job.name === safetyVerificationJobNames.reconcileStatuses) {
      const summary = await runtime.runPromise(reconcileCheckOrderStatuses);
      console.log(
        `safety-verification reconcile: ${summary.advanced} advanced, ` +
          `${summary.unreachable} unreachable, ${summary.failed} failed of ${summary.checked}`
      );
      return;
    }

    if (job.name === safetyVerificationJobNames.recoverPayments) {
      const summary = await runtime.runPromise(recoverPendingPayments(new Date()));
      console.log(
        `payment recovery: ${summary.captured} captured, ${summary.failed} failed ` +
          `(${summary.abandoned} abandoned), ${summary.errors} errors of ${summary.checked}`
      );
      return;
    }

    if (job.name === safetyVerificationJobNames.sweepExpiries) {
      const summary = await runtime.runPromise(
        processSafetyVerificationExpiries(new Date(), uiOrigin)
      );
      console.log(
        `safety-verification expiry sweep: ${summary.lapsed} lapsed, ` +
          `${summary.notified} notified, ${summary.failed} failed of ${summary.candidates}`
      );
      return;
    }

    console.warn(`safety-verification: unknown job ${job.name}`);
  },
  {
    connection,
    // Orders spend money — keep concurrency low enough that a burst can't
    // outrun the per-record idempotency guards.
    concurrency: Number.parseInt(process.env.SAFETY_VERIFICATION_WORKER_CONCURRENCY ?? '3', 10)
  }
);

const approvalExpiryWorker = new Worker(
  approvalExpiryQueueDefinition.name,
  async () => {
    const summary = await runtime.runPromise(
      processApprovalExpiryNotifications(new Date(), uiOrigin)
    );
    console.log(
      `approval-expiry sweep: ${summary.notified} notified, ${summary.skipped} skipped, ${summary.failed} failed of ${summary.candidates} candidates`
    );
  },
  { connection, concurrency: 1 }
);

const contractBillingWorker = new Worker(
  contractBillingQueueDefinition.name,
  async (job) => {
    if (job.name !== contractBillingJobNames.tick) {
      console.warn(`contract-billing: unknown job ${job.name}`);
      return;
    }
    const summary = await runtime.runPromise(processContractBillingTick(new Date()));
    console.log(describeTick(summary));
  },
  // One tick at a time: ticks are idempotent, but there is nothing to gain
  // from two racing over the same contracts.
  { connection, concurrency: 1 }
);

const contractBillingQueue = new Queue(contractBillingQueueDefinition.name, { connection });

void contractBillingQueue
  .upsertJobScheduler(
    contractBillingSchedulerId,
    { pattern: contractBillingCronPattern },
    { name: contractBillingJobNames.tick, data: {} }
  )
  .catch((cause) => {
    console.error(cause);
  });

const approvalExpiryQueue = new Queue(approvalExpiryQueueDefinition.name, { connection });

// Repeatable daily sweep at 02:00 (server timezone). Upsert is idempotent
// across worker restarts and updates the schedule if the pattern changes.
const scheduleApprovalExpirySweep = async () => {
  await approvalExpiryQueue.upsertJobScheduler(
    approvalExpirySchedulerId,
    { pattern: approvalExpiryCronPattern },
    { name: approvalExpiryJobNames.notifyExpiring, data: {} }
  );
};

void scheduleApprovalExpirySweep().catch((cause) => {
  // TODO: log this failure to Sentry once error reporting is wired.
  console.error(cause);
});

const safetyVerificationQueue = new Queue(safetyVerificationQueueDefinition.name, { connection });

const scheduleSafetyVerificationJobs = async () => {
  // The reconcile poll is the ONLY recovery path for a dropped Credibled
  // webhook — they log a failed delivery and never retry it.
  await safetyVerificationQueue.upsertJobScheduler(
    safetyVerificationReconcileSchedulerId,
    { pattern: safetyVerificationReconcileCronPattern },
    { name: safetyVerificationJobNames.reconcileStatuses, data: {} }
  );
  // Backstop for payments neither the browser nor a webhook settled.
  await safetyVerificationQueue.upsertJobScheduler(
    paymentRecoverySchedulerId,
    { pattern: safetyVerificationReconcileCronPattern },
    { name: safetyVerificationJobNames.recoverPayments, data: {} }
  );
  await safetyVerificationQueue.upsertJobScheduler(
    safetyVerificationExpirySchedulerId,
    { pattern: safetyVerificationExpiryCronPattern },
    { name: safetyVerificationJobNames.sweepExpiries, data: {} }
  );
};

void scheduleSafetyVerificationJobs().catch((cause) => {
  console.error(cause);
});

// Orders charged but never placed — a queue job lost between the charge and
// the order would otherwise leave somebody paid-up with nothing happening.
void runtime
  .runPromise(recoverUnplacedCheckOrders)
  .then(({ recovered }) => {
    if (recovered > 0) {
      console.log(`safety-verification: recovered ${recovered} unordered check(s) on boot`);
    }
  })
  .catch((cause) => {
    console.error(cause);
  });

const queueDashQueues = queues.map((queue) => ({
  queue: new Queue(queue.name, { connection }),
  displayName: queue.displayName,
  type: queue.type
}));

const providerSearchQueue = new Queue(providerSearchQueueDefinition.name, { connection });
const familySearchQueue = new Queue(familySearchQueueDefinition.name, { connection });

const enqueueUnresolvedOutboxRows = async () => {
  const rows = await runtime.runPromise(
    ProviderSearchOutboxRepo.pipe(Effect.flatMap((repo) => repo.listUnresolved(1_000)))
  );

  await Promise.all(
    rows.map((row) =>
      providerSearchQueue.add(
        providerSearchJobNames.reconcileProvider,
        { outboxId: row.id, userId: row.userId },
        { deduplication: { id: `provider-search-reconcile-${row.userId}` } }
      )
    )
  );
};

void enqueueUnresolvedOutboxRows().catch((cause) => {
  // TODO: log this failure to Sentry once error reporting is wired.
  console.error(cause);
});

const enqueueUnresolvedFamilyOutboxRows = async () => {
  const rows = await runtime.runPromise(
    FamilySearchOutboxRepo.pipe(Effect.flatMap((repo) => repo.listUnresolved(1_000)))
  );

  await Promise.all(
    rows.map((row) =>
      familySearchQueue.add(
        familySearchJobNames.reconcileFamily,
        { outboxId: row.id, userId: row.userId },
        { deduplication: { id: `family-search-reconcile-${row.userId}` } }
      )
    )
  );
};

void enqueueUnresolvedFamilyOutboxRows().catch((cause) => {
  // TODO: log this failure to Sentry once error reporting is wired.
  console.error(cause);
});

// Full rebuild of both search indexes on every launch. A fresh Typesense has
// no collections at all (until now only an admin-triggered reindex created
// them, so every search 502'd on a new stack), and a restart is also the
// moment the index is most likely to have drifted from the database. The
// rebuild is idempotent, reads the DB as the source of truth, and dedupes
// against a reindex an admin may already have queued.
const enqueueFullReindexOnBoot = async () => {
  await Promise.all([
    providerSearchQueue.add(
      providerSearchJobNames.reindexAllProviders,
      {},
      { deduplication: { id: providerSearchReindexDeduplicationId } }
    ),
    familySearchQueue.add(
      familySearchJobNames.reindexAllFamilies,
      {},
      { deduplication: { id: familySearchReindexDeduplicationId } }
    )
  ]);
  console.log('search: queued a full reindex of providers and families on boot');
};

void enqueueFullReindexOnBoot().catch((cause) => {
  // TODO: log this failure to Sentry once error reporting is wired.
  console.error(cause);
});

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/queues', (req, res, next) => {
  const username = process.env.QUEUE_UI_USERNAME;
  const password = process.env.QUEUE_UI_PASSWORD;

  if (!username || !password) return next();

  const header = req.headers.authorization;
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  if (header === expected) return next();

  res.setHeader('WWW-Authenticate', 'Basic realm="Queue UI"');
  res.status(401).send('Unauthorized');
});

app.use(
  '/queues',
  createQueueDashExpressMiddleware({
    ctx: { queues: queueDashQueues }
  })
);

const port = Number.parseInt(process.env.WORKER_HTTP_PORT ?? '3001', 10);
const server = app.listen(port, () => {
  console.log(`Worker HTTP server listening on ${port}`);
});

const shutdown = async () => {
  server.close();
  await providerSearchWorker.close();
  await providerSearchQueue.close();
  await familySearchWorker.close();
  await familySearchQueue.close();
  await approvalExpiryWorker.close();
  await approvalExpiryQueue.close();
  await safetyVerificationWorker.close();
  await safetyVerificationQueue.close();
  await contractBillingWorker.close();
  await contractBillingQueue.close();
  await Promise.all(queueDashQueues.map(({ queue }) => queue.close()));
  await runtime.dispose();
};

process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit(0));
});

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(0));
});
