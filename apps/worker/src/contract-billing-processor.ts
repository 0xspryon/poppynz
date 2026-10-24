import { runContractBillingTick, type ContractBillingTickSummary } from '@repo/billing';

/**
 * Contract billing, every 15 minutes (piece 3): for every live contract,
 * materialise the session window, then hold, capture, retry, suspend, resume
 * or cancel whatever is due at `now`. Each cycle stores the instants it is
 * due at, so a late or missed run simply catches up.
 */
export const processContractBillingTick = (now: Date) => runContractBillingTick(now);

export const describeTick = (summary: ContractBillingTickSummary) =>
  `contract billing: ${summary.ran} ran, ${summary.failed} failed of ${summary.contracts} live contracts`;
