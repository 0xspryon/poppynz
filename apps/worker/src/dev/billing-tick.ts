/**
 * DEV ONLY — run the contract-billing tick "as of" an instant, to watch a
 * contract go hold → capture, or decline → grace → suspension → resume,
 * without waiting days. Exactly the worker's tick, with `now` replaced —
 * including its session-resolution step (silence confirms a report once its
 * response window closes; an unconfirmed day off lapses at its cutoff) and
 * its extra-session step (unanswered proposals lapse; agreed extra sessions
 * past their charge delay are folded into their cycle or charged on their
 * own; declined charges retried; long-unpaid ones alerted) and its money
 * step (resolutions applied, session refunds sent, and — with --as-of at or
 * after a cycle's transfer time — helper transfers made).
 *
 *   docker compose exec worker sh -c 'cd /usr/src/app && ENVIRONMENT=dev \
 *     BILLING_DEV_CLOCK=enabled bun apps/worker/src/dev/billing-tick.ts \
 *     --as-of 2026-11-02T12:00:00Z [--contract <contract id>]'
 *
 * or from the host, against the docker Postgres:
 *
 *   TZ=UTC ENVIRONMENT=dev BILLING_DEV_CLOCK=enabled \
 *     DATABASE_URL=postgres://user:pass@localhost:5432/poppynz_dev \
 *     bun --env-file=apps/api/.env apps/worker/src/dev/billing-tick.ts --as-of …
 *
 * Without --as-of it prints the schedule only. Refuses to start outside a
 * local dev stack (see ./guard.ts). Holds and charges are real Stripe
 * test-mode calls made at the real time; payout readiness is Stripe's real
 * state. Must run in UTC, like the containers (see ./guard.ts).
 */
import {
  ContractBillingRepo,
  ExtraSessionRepo,
  SessionMoneyRepo,
  SessionResolutionRepo
} from '@repo/db';
import {
  runContractBillingTick,
  runExtraSessionTick,
  runSessionMoneyTick,
  runSessionResolutionTick
} from '@repo/billing';
import { Effect, ManagedRuntime } from 'effect';
import { ContractBillingBaseLive, withCycleSettlement } from '../billing-layer';
import { requireDevClock, requireLocalDatabase } from './guard';

requireDevClock();
requireLocalDatabase();

const argument = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const asOfRaw = argument('as-of');
const contractId = argument('contract');
const asOf = asOfRaw ? new Date(asOfRaw) : null;
if (asOfRaw && (asOf === null || Number.isNaN(asOf.getTime()))) {
  console.error(`--as-of must be an ISO instant, e.g. 2026-11-02T12:00:00Z (got ${asOfRaw})`);
  process.exit(1);
}

const runtime = ManagedRuntime.make(withCycleSettlement(ContractBillingBaseLive));

const show = Effect.gen(function* () {
  const repo = yield* ContractBillingRepo;
  const live = yield* repo.listLiveBilling();
  const all = contractId
    ? [yield* repo.findBilling(contractId)].filter((row) => row !== null)
    : live;
  for (const billing of all) {
    console.log(
      `\ncontract ${billing.contractId}: ${billing.status}` +
        (billing.suspendedReason ? ` (${billing.suspendedReason})` : '') +
        ` · zone ${billing.timeZone} · starts ${billing.startsOn}`
    );
    const resolutions = (yield* (yield* SessionResolutionRepo).listForContract(
      billing.contractId
    )).filter((row) => row.status === 'proposed' || row.status === 'contested');
    for (const row of resolutions) {
      console.log(
        `  session ${row.sessionId}: ${row.kind} ${row.status}` +
          (row.respondBy ? ` · answer by ${row.respondBy.toISOString()}` : '')
      );
    }
    // Tier 3 step 3: extra sessions still in motion.
    for (const extra of yield* (yield* ExtraSessionRepo).listForContract(billing.contractId)) {
      if (!['proposed', 'agreed', 'charging', 'charge_failed'].includes(extra.status)) continue;
      console.log(
        `  extra ${extra.id} ${extra.date} ${extra.startMinutes}–${extra.endMinutes}: ${extra.status}` +
          (extra.status === 'proposed' ? ` · answer by ${extra.respondBy.toISOString()}` : '') +
          (extra.chargeAt && extra.status === 'agreed'
            ? ` · charged at ${extra.chargeAt.toISOString()}`
            : '') +
          (extra.nextRetryAt ? ` · retry at ${extra.nextRetryAt.toISOString()}` : '') +
          (extra.lastError ? ` — ${extra.lastError}` : '')
      );
    }
    const cycles = yield* repo.listCycles(billing.contractId);
    const money = yield* SessionMoneyRepo;
    const refunds = yield* money.listRefunds({ contractId: billing.contractId });
    const transfers = yield* money.listTransfers({ contractId: billing.contractId });
    const dollars = (cents: number | null) =>
      cents === null ? '—' : `$${(cents / 100).toFixed(2)}`;
    for (const cycle of cycles.slice(0, 8)) {
      const amount =
        cycle.familyTotalCents === null ? '' : ` $${(cycle.familyTotalCents / 100).toFixed(2)}`;
      console.log(
        `  #${cycle.index + 1} ${cycle.startsOn}…${cycle.endsOn} ${cycle.status.padEnd(14)}${amount}` +
          `  hold ${cycle.holdAt.toISOString()}  capture ${cycle.captureAt.toISOString()}` +
          `  start ${cycle.startsAt.toISOString()}  transfer ${cycle.transferAt.toISOString()}` +
          (cycle.lastError ? `  — ${cycle.lastError}` : '')
      );
      for (const refund of refunds.filter((row) => row.cycleId === cycle.id)) {
        console.log(
          `      refund ${refund.id} session ${refund.sessionId}: ${dollars(refund.totalCents)} ${refund.status}` +
            (refund.providerReference ? ` (${refund.providerReference})` : '') +
            (refund.failureReason ? ` — ${refund.failureReason}` : '')
        );
      }
      for (const transfer of transfers.filter((row) => row.cycleId === cycle.id)) {
        console.log(
          `      transfer #${transfer.sequence} ${transfer.status}: ${dollars(transfer.amountCents)}` +
            (transfer.recoveredCents
              ? ` (after ${dollars(transfer.recoveredCents)} recovered)`
              : '') +
            ` due ${transfer.dueAt.toISOString()}` +
            (transfer.providerReference ? ` (${transfer.providerReference})` : '') +
            (transfer.failureReason ? ` — ${transfer.failureReason}` : '')
        );
      }
    }
  }
});

const main = Effect.gen(function* () {
  if (asOf) {
    console.log(
      `[dev-billing] tick as of ${asOf.toISOString()}${contractId ? ` for ${contractId}` : ''}`
    );
    const summary = yield* runContractBillingTick(asOf, contractId ? { contractId } : {});
    console.log(
      `[dev-billing] ${summary.ran} ran, ${summary.failed} failed of ${summary.contracts}`
    );
    // The same tick's session-resolution step: silence confirms reports whose
    // response window closed, unconfirmed days off lapse at their cutoff.
    const resolutions = yield* runSessionResolutionTick(asOf);
    console.log(
      `[dev-billing] session resolutions: ${resolutions.confirmed} confirmed, ${resolutions.lapsed} lapsed, ${resolutions.failed} failed`
    );
    // The extra-session step: lapses, the delayed charge, retries, alerts.
    const extras = yield* runExtraSessionTick(asOf);
    console.log(
      `[dev-billing] extra sessions: ${extras.lapsed} lapsed, ${extras.folded} folded, ${extras.charged} charged, ${extras.declined} declined, ${extras.failed} failed`
    );
    // The money step: resolutions applied, refunds sent, transfers due by
    // --as-of made (paused, or queued for a manual payout).
    const money = yield* runSessionMoneyTick(asOf);
    console.log(
      `[dev-billing] money: ${money.reconciled} sessions applied, ${money.refundsSent} refunds sent, ${money.transfers} transfers processed, ${money.failed} failed`
    );
  }
  yield* show;
});

runtime
  .runPromise(main)
  .then(() => runtime.dispose())
  .then(() => process.exit(0))
  .catch(async (cause) => {
    console.error(cause);
    await runtime.dispose();
    process.exit(1);
  });
