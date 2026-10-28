import type { SqlError } from '@effect/sql/SqlError';
import { CardDisputeRepo, type CardDispute, type CardDisputeSession } from '@repo/db';
import { Payments } from '@repo/payments';
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
 * `CardDisputeLedgerLive` reads step 4's records (`card_disputes`,
 * `card_dispute_sessions`); `CardDisputeLedgerNone` (no disputes) remains
 * for tests and tools without them.
 *
 * What Poppynz bears (spec §15, umbrella §9), per dispute:
 *   - the provider's dispute fee (`fee_cents`), kept whatever the outcome;
 *   - once LOST: the net debit (`withdrawn − reinstated`) minus what the
 *     helpers bear (`helper_forfeit_cents` of sessions allocated "did not
 *     provide"; capped by step 4 at what they were owed, default 13). A lost
 *     dispute not allocated yet is borne in full until an admin decides.
 * An open dispute's withdrawn funds are not counted (the issuer hasn't
 * decided); a won one costs the fee only. These amounts come from the
 * dispute rows, which step 4 keeps in step with the same balance
 * transactions it writes to the ledger (`dispute_withdrawn`,
 * `dispute_reinstated`, `dispute_fee`, shown in an item's trail); so the
 * ledger's `platform_absorbed` entries of an allocation ("Poppynz absorbs",
 * keyed `card_dispute:…`) are NOT read again by the obligations ledger.
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

/** The ledger entries step 4 writes for disputes: counted through this
 * adapter, never twice. */
export const isCardDisputeEntryKey = (entryKey: string) => entryKey.startsWith('card_dispute:');

/** What Poppynz bears for these disputes (pure; see above). */
export const borneByPoppynz = (
  disputes: ReadonlyArray<CardDispute>,
  sessions: ReadonlyArray<CardDisputeSession>
): Array<BorneCardDispute> =>
  disputes.flatMap((dispute) => {
    const mine = sessions.filter((row) => row.disputeId === dispute.id);
    const base = {
      disputeId: dispute.id,
      providerReference: dispute.providerReference,
      paymentId: dispute.paymentId,
      contractId: dispute.contractId,
      cycleId: dispute.cycleId,
      sessionId: mine.length === 1 ? mine[0]!.sessionId : null,
      familyUserId: dispute.familyUserId
    };
    const items: Array<BorneCardDispute> = [];
    if (dispute.feeCents > 0) {
      items.push({
        ...base,
        id: `${dispute.id}:fee`,
        cause: 'card_dispute_fee',
        amountCents: dispute.feeCents,
        status: dispute.status,
        occurredAt: dispute.providerCreatedAt
      });
    }
    if (dispute.status === 'lost') {
      const forfeit = mine.reduce(
        (total, row) =>
          total + (row.allocation === 'helper_not_provided' ? row.helperForfeitCents : 0),
        0
      );
      const unallocated = mine.some((row) => row.allocation === null);
      const amount = Math.max(0, dispute.withdrawnCents - dispute.reinstatedCents - forfeit);
      if (amount > 0) {
        items.push({
          ...base,
          id: dispute.id,
          cause: 'card_dispute',
          amountCents: amount,
          status: unallocated ? 'lost (allocation pending)' : 'lost',
          occurredAt: dispute.closedAt ?? dispute.providerCreatedAt
        });
      }
    }
    return items;
  });

/** Step 4's records, read through its repo. */
export const CardDisputeLedgerLive = Layer.effect(
  CardDisputeLedger,
  Effect.gen(function* () {
    const repo = yield* CardDisputeRepo;
    const payments = yield* Payments;
    return {
      listBorneByPoppynz: () =>
        Effect.gen(function* () {
          const disputes = yield* repo.list({});
          const sessions =
            disputes.length === 0
              ? []
              : yield* repo.listSessions({ disputeIds: disputes.map((row) => row.id) });
          return borneByPoppynz(disputes, sessions);
        }),
      findByProviderReference: (reference) =>
        repo
          .findByProviderReference(payments.provider, reference)
          .pipe(
            Effect.map((row) =>
              row
                ? { disputeId: row.id, paymentId: row.paymentId, amountCents: row.amountCents }
                : null
            )
          )
    };
  })
);
