import {
  runContractBillingTick,
  runSessionResolutionTick,
  type ContractBillingTickSummary,
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
 * and unconfirmed days off lapse at their cancellation cutoff. It changes no
 * money (step 1).
 */
export const processContractBillingTick = (now: Date) =>
  Effect.gen(function* () {
    const billing = yield* runContractBillingTick(now);
    const resolutions = yield* runSessionResolutionTick(now);
    return { ...billing, resolutions };
  });

export const describeTick = (
  summary: ContractBillingTickSummary & { resolutions?: ResolutionTickSummary }
) =>
  `contract billing: ${summary.ran} ran, ${summary.failed} failed of ${summary.contracts} live contracts` +
  (summary.resolutions
    ? `; session resolutions: ${summary.resolutions.confirmed} confirmed, ${summary.resolutions.lapsed} lapsed, ${summary.resolutions.failed} failed`
    : '');
