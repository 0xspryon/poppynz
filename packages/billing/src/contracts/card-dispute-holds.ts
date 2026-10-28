import type { SessionCardDispute } from '@repo/db';

/**
 * What card disputes do to a session's helper pay (Tier 3 step 4, spec
 * 2026-10-28 §15). Pure, shared by the transfer step and the dispute flows.
 *
 *   - While a dispute on the session's charge is open — or lost and not yet
 *     allocated by an admin — pay not transferred yet is HELD, like a
 *     session dispute. Pay already sent is never touched (no reversal).
 *   - Once allocated, `forfeitCents` is what the helper bears ("the helper
 *     didn't provide the service"): it is not paid, or — if it was already
 *     paid — recovered from the helper's next transfers.
 *   - Won (or an inquiry closed) releases the pay.
 */
export type CardDisputeHold = { held: boolean; forfeitCents: number };

export const cardDisputeHold = (
  rows: ReadonlyArray<SessionCardDispute>,
  sessionId: string
): CardDisputeHold => {
  const mine = rows.filter((row) => row.sessionId === sessionId);
  return {
    held: mine.some((row) => !row.closed || (row.status === 'lost' && row.allocation === null)),
    forfeitCents: mine.reduce((total, row) => total + row.helperForfeitCents, 0)
  };
};

/** What the helper is owed for a session once the card disputes' forfeits
 * are taken off (never below zero). */
export const owedAfterCardDisputes = (owedCents: number, hold: CardDisputeHold) =>
  Math.max(0, owedCents - hold.forfeitCents);
