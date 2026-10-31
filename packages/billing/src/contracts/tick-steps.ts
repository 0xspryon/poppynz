import { Effect } from 'effect';
import { runCardDisputeTick } from './card-disputes';
import { runContractBillingTick } from './engine';
import { runExtraSessionTick } from './extra-sessions';
import { runSessionMoneyTick } from './money';
import { runSessionResolutionTick } from './resolutions';

/** `contractId` limits every step to that one contract; without it every
 * contract is processed (the worker's tick). */
export type BillingTickOptions = { contractId?: string };

/**
 * The billing tick's steps as of `now`, in the worker's order:
 *
 *   1. card disputes — evidence reminders due by `now` (Tier 3 step 4);
 *   2. contract billing — materialise sessions; hold, capture, retry,
 *      suspend, resume or cancel what is due (piece 3);
 *   3. session resolutions — silence confirms reports, unconfirmed days off
 *      lapse (Tier 3);
 *   4. extra sessions — lapses, the delayed charge, retries, alerts, payouts
 *      (Tier 3 step 3);
 *   5. money — resolutions applied, refunds sent, transfers made (Tier 3
 *      step 2).
 *
 * The worker runs it unscoped every 15 minutes; the dev billing clock and the
 * admin billing fast-forward (staging UAT) run it for one contract. Each step
 * is safe late, twice or concurrently (see engine.ts).
 */
export const runBillingTickSteps = (now: Date, options: BillingTickOptions = {}) =>
  Effect.gen(function* () {
    const disputes = yield* runCardDisputeTick(now, options);
    const billing = yield* runContractBillingTick(now, options);
    const resolutions = yield* runSessionResolutionTick(now, options);
    const extraSessions = yield* runExtraSessionTick(now, options);
    const money = yield* runSessionMoneyTick(now, options);
    return { disputes, billing, resolutions, extraSessions, money };
  });

export type BillingTickStepsSummary = Effect.Effect.Success<ReturnType<typeof runBillingTickSteps>>;

/** How many items failed across every step (each is isolated and counted). */
export const failedTickItems = (summary: BillingTickStepsSummary) =>
  summary.disputes.failed +
  summary.billing.failed +
  summary.resolutions.failed +
  summary.extraSessions.failed +
  summary.money.failed;
