import { runScheduledReconciliation } from '@repo/billing';
import { Effect } from 'effect';

/**
 * Reconciliation with the payment provider (Tier 3 step 5, spec §16): run
 * from the contract-billing job after each tick, it imports the provider's
 * balance transactions over `RECONCILIATION_LOOKBACK_DAYS` once the last
 * scheduled run is `RECONCILIATION_INTERVAL_HOURS` old (24 by default) —
 * no cron of its own, so a late or missed tick simply catches up. It never
 * fails the billing job: a failure is logged, and the run is recorded as
 * failed for the accountant.
 */
export const processReconciliationTick = (now: Date) =>
  runScheduledReconciliation(now).pipe(
    Effect.map((summary) =>
      summary === null
        ? 'reconciliation: not due'
        : `reconciliation: ${summary.run.status}, ${summary.imported} imported, ${summary.matched} matched, ${summary.unmatched} unmatched, ${summary.payoutsExact} transfer(s) matched to their payout`
    ),
    Effect.catchAll((error) =>
      Effect.logError('[reconciliation] the scheduled run could not start', error).pipe(
        Effect.as('reconciliation: could not start (see the log)')
      )
    )
  );
