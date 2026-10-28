import type { SqlError } from '@effect/sql/SqlError';
import { Context, Effect, Layer } from 'effect';

/**
 * THE STEP-4 ADAPTER (Tier 3 step 5, spec §16).
 *
 * Card disputes (chargebacks) are step 4's (`card_disputes`, migration
 * 0045), built on another branch. The accountant's views read them only
 * through this port, so they plug in by implementing it — nothing else in
 * the reimbursements ledger, the reports or the reconciliation knows the
 * dispute tables:
 *
 *   - `listBorneByPoppynz`: the disputed amounts Poppynz bears (a lost
 *     dispute allocated to Poppynz, or not allocated to the helper) and the
 *     provider's dispute fees — "absorbed" items of cause `card_dispute` and
 *     `card_dispute_fee`;
 *   - `findByProviderReference`: the dispute behind a provider dispute
 *     object (`du_…`/`dp_…`), to match the balance transactions that
 *     withdraw and reinstate its funds and charge its fee.
 *
 * Until step 4 is merged the layer is `CardDisputeLedgerNone`: no borne
 * amounts, and dispute transactions stay unmatched for the accountant.
 */

/** What Poppynz bears for one dispute (or one of its sessions). */
export type BorneCardDispute = {
  /** Stable per item: `<disputeId>` or `<disputeId>:<sessionId>`. */
  id: string;
  disputeId: string;
  /** The provider's dispute (`du_…`/`dp_…`). */
  providerReference: string;
  /** `card_dispute`: the disputed money lost; `card_dispute_fee`: the fee. */
  cause: 'card_dispute' | 'card_dispute_fee';
  amountCents: number;
  paymentId: string | null;
  contractId: string | null;
  cycleId: string | null;
  sessionId: string | null;
  familyUserId: string | null;
  /** The dispute's provider status (`lost`, `won`, …). */
  status: string;
  /** When Poppynz came to bear it (closed, or the fee's debit). */
  occurredAt: Date;
};

export type CardDisputeMatch = {
  disputeId: string;
  paymentId: string | null;
  amountCents: number;
};

export class CardDisputeLedger extends Context.Tag('@repo/billing/CardDisputeLedger')<
  CardDisputeLedger,
  {
    listBorneByPoppynz: () => Effect.Effect<ReadonlyArray<BorneCardDispute>, SqlError>;
    findByProviderReference: (
      reference: string
    ) => Effect.Effect<CardDisputeMatch | null, SqlError>;
  }
>() {}

/** Before step 4: no dispute records. */
export const CardDisputeLedgerNone = Layer.succeed(CardDisputeLedger, {
  listBorneByPoppynz: () => Effect.succeed([]),
  findByProviderReference: () => Effect.succeed(null)
});

/** Tests: fixed disputes. */
export const makeCardDisputeLedgerTest = (
  borne: ReadonlyArray<BorneCardDispute> = [],
  matches: Record<string, CardDisputeMatch> = {}
) =>
  Layer.succeed(CardDisputeLedger, {
    listBorneByPoppynz: () => Effect.succeed(borne),
    findByProviderReference: (reference) => Effect.succeed(matches[reference] ?? null)
  });
