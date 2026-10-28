import {
  runContractBillingTick,
  runExtraSessionTick,
  runSessionMoneyTick,
  runSessionResolutionTick,
  type ContractBillingTickSummary,
  type ExtraSessionTickSummary,
  type MoneyTickSummary,
  type ResolutionTickSummary
} from '@repo/billing';
import { Effect } from 'effect';

/**
 * Contract billing, every 15 minutes (piece 3): for every live contract,
 * materialise the session window, then hold, capture, retry, suspend, resume
 * or cancel whatever is due at `now`. Each cycle stores the instants it is
 * due at, so a late or missed run simply catches up.
 *
 * Then the session-resolution step (Tier 3): unanswered reports whose
 * response window has closed are confirmed (silence counts as acceptance)
 * and unconfirmed days off lapse at their cancellation cutoff.
 *
 * Then the extra-session step (Tier 3 step 3): unanswered proposals lapse,
 * agreed extra sessions past their charge delay are folded into their
 * cycle's charge or charged on their own, declined charges are retried on
 * schedule, long-unpaid ones alert the admins, and charged ones are paid out.
 *
 * Then the money step (Tier 3 step 2): every resolution is applied to the
 * money (left out of the plan, a reduced capture, a session refund, a
 * recovery), pending refunds are (re)sent, and helper transfers that are
 * due are made — or paused, or moved to the manual payout queue.
 */
export const processContractBillingTick = (now: Date) =>
  Effect.gen(function* () {
    const billing = yield* runContractBillingTick(now);
    const resolutions = yield* runSessionResolutionTick(now);
    const extraSessions = yield* runExtraSessionTick(now);
    const money = yield* runSessionMoneyTick(now);
    return { ...billing, resolutions, extraSessions, money };
  });

export const describeTick = (
  summary: ContractBillingTickSummary & {
    resolutions?: ResolutionTickSummary;
    extraSessions?: ExtraSessionTickSummary;
    money?: MoneyTickSummary;
  }
) =>
  `contract billing: ${summary.ran} ran, ${summary.failed} failed of ${summary.contracts} live contracts` +
  (summary.resolutions
    ? `; session resolutions: ${summary.resolutions.confirmed} confirmed, ${summary.resolutions.lapsed} lapsed, ${summary.resolutions.failed} failed`
    : '') +
  (summary.extraSessions
    ? `; extra sessions: ${summary.extraSessions.lapsed} lapsed, ${summary.extraSessions.folded} folded, ${summary.extraSessions.charged} charged, ${summary.extraSessions.declined} declined, ${summary.extraSessions.failed} failed`
    : '') +
  (summary.money
    ? `; money: ${summary.money.reconciled} sessions applied, ${summary.money.refundsSent} refunds sent, ${summary.money.transfers} transfers processed, ${summary.money.failed} failed`
    : '');
