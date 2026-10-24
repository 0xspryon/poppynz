/**
 * DEV ONLY — run the contract-billing tick "as of" an instant, to watch a
 * contract go hold → capture, or decline → grace → suspension → resume,
 * without waiting days. Exactly the worker's tick, with `now` replaced.
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
import { ContractBillingRepo } from '@repo/db';
import { runContractBillingTick } from '@repo/billing';
import { Effect, ManagedRuntime } from 'effect';
import { ContractBillingBaseLive, withCycleSettlement } from '../billing-layer';
import { requireDevClock } from './guard';

requireDevClock();

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
    const cycles = yield* repo.listCycles(billing.contractId);
    for (const cycle of cycles.slice(0, 8)) {
      const amount =
        cycle.familyTotalCents === null ? '' : ` $${(cycle.familyTotalCents / 100).toFixed(2)}`;
      console.log(
        `  #${cycle.index + 1} ${cycle.startsOn}…${cycle.endsOn} ${cycle.status.padEnd(14)}${amount}` +
          `  hold ${cycle.holdAt.toISOString()}  capture ${cycle.captureAt.toISOString()}` +
          `  start ${cycle.startsAt.toISOString()}` +
          (cycle.lastError ? `  — ${cycle.lastError}` : '')
      );
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
