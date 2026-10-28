import type { SqlError } from '@effect/sql/SqlError';
import {
  ReconciliationRepo,
  type BalanceTransactionMatchKind,
  type BalanceTransactionMatchStatus,
  type BalanceTransactionUpsert,
  type ProviderBalanceTransactionRow,
  type ReconciliationLookups,
  type ReconciliationRun
} from '@repo/db';
import { reconciliationConfig } from '@repo/env';
import {
  Payments,
  type PaymentProviderError,
  type ProviderBalanceTransaction,
  type ProviderPayout
} from '@repo/payments';
import { Data, Effect, Either } from 'effect';
import { CardDisputeLedger, type CardDisputeMatch } from './card-dispute-adapter';

/**
 * Reconciliation with the payment provider (Tier 3 step 5, spec §16).
 *
 * A run imports the provider's balance transactions for a period (the
 * platform's, page by page with `startingAfter`), stores each once by its
 * reference (`provider_balance_transactions`; a re-import updates it) and
 * matches it to what we recorded, BY REFERENCE:
 *
 *   | provider transaction                | ours                                 |
 *   | charge (its PaymentIntent)          | the payment                          |
 *   | refund / refund_failure (`re_…`)    | the session refund, or a one-off one |
 *   | transfer (`tr_…`)                   | the helper transfer                  |
 *   | payout (`po_…`) on the platform     | Poppynz's own bank payout            |
 *   | fee transactions (`stripe_fee`, …)  | the provider's fees                  |
 *   | dispute adjustments (`du_…`)        | the card dispute (step-4 adapter)    |
 *
 * A reference of ours with another amount is a `mismatch`. What matches
 * nothing — on either side — is listed for the accountant, who can resolve
 * it with a note (audited).
 *
 * Then helper payouts (§13.4): for each helper paid in the period, their
 * connected account's payouts are listed; an AUTOMATIC payout's own balance
 * transactions name the transfers it paid out (a `payment` whose source
 * charge carries `source_transfer: tr_…`, verified in test mode), so those
 * transfers are marked paid EXACTLY. A manual payout can't be listed that
 * way (Stripe refuses the filter); the payout webhook's approximate match
 * (by timing) stays, labelled as such.
 */

export class ReconciliationBusyError extends Data.TaggedError('ReconciliationBusyError')<{}> {}

/** Runs still `running` after this long were abandoned (a crash). */
const STALE_RUN_MS = 6 * 3600_000;

/** A scheduled run that failed (the provider was unreachable, say) is tried
 * again this soon rather than a whole interval later. */
const FAILED_RUN_RETRY_MS = 3600_000;

export type MatchResult = {
  matchStatus: BalanceTransactionMatchStatus;
  matchKind: BalanceTransactionMatchKind | null;
  matchedId: string | null;
  matchNote: string | null;
};

const FEE_TYPES = new Set(['stripe_fee', 'application_fee', 'tax_fee', 'stripe_fx_fee']);

const matched = (
  kind: BalanceTransactionMatchKind,
  id: string | null,
  expected: number | null,
  actual: number
): MatchResult =>
  expected === null || expected === actual
    ? { matchStatus: 'matched', matchKind: kind, matchedId: id, matchNote: null }
    : {
        matchStatus: 'mismatch',
        matchKind: kind,
        matchedId: id,
        matchNote: `amount ${actual} at the provider, ${expected} on our side`
      };

const unmatched = (note: string): MatchResult => ({
  matchStatus: 'unmatched',
  matchKind: null,
  matchedId: null,
  matchNote: note
});

/** Matches one platform balance transaction to our rows (pure). */
export const matchBalanceTransaction = (
  txn: ProviderBalanceTransaction,
  lookups: ReconciliationLookups,
  dispute: CardDisputeMatch | null
): MatchResult => {
  if (FEE_TYPES.has(txn.type) || txn.reportingCategory === 'fee') {
    return { matchStatus: 'matched', matchKind: 'stripe_fee', matchedId: null, matchNote: null };
  }
  switch (txn.type) {
    case 'charge':
    case 'payment': {
      const payment = lookups.payments.find(
        (row) => row.providerReference !== null && row.providerReference === txn.paymentReference
      );
      if (!payment) return unmatched('no payment of ours for this charge');
      return matched(
        'payment',
        payment.id,
        payment.capturedCents ?? payment.totalCents,
        txn.amountCents
      );
    }
    case 'refund':
    case 'payment_refund':
    case 'refund_failure': {
      const refund = lookups.refunds.find(
        (row) => row.providerReference !== null && row.providerReference === txn.sourceReference
      );
      // A refund takes money out (negative); its failure puts it back.
      const sign = txn.type === 'refund_failure' ? 1 : -1;
      if (refund)
        return matched('session_refund', refund.id, sign * refund.totalCents, txn.amountCents);
      const oneOff = lookups.payments.find(
        (row) => row.refundReference !== null && row.refundReference === txn.sourceReference
      );
      if (oneOff) {
        return matched(
          'payment_refund',
          oneOff.id,
          sign * (oneOff.capturedCents ?? oneOff.totalCents),
          txn.amountCents
        );
      }
      return unmatched('no refund of ours for this refund');
    }
    case 'transfer': {
      const transfer = lookups.transfers.find(
        (row) => row.providerReference !== null && row.providerReference === txn.sourceReference
      );
      if (!transfer) return unmatched('no helper transfer of ours for this transfer');
      return matched(
        'helper_transfer',
        transfer.id,
        transfer.amountCents === null ? null : -transfer.amountCents,
        txn.amountCents
      );
    }
    case 'payout':
      return {
        matchStatus: 'matched',
        matchKind: 'platform_payout',
        matchedId: null,
        matchNote: null
      };
    default:
      break;
  }
  if (txn.reportingCategory.startsWith('dispute') || txn.sourceType === 'dispute') {
    if (dispute) return matched('card_dispute', dispute.disputeId, null, txn.amountCents);
    return unmatched('no card dispute on file for this dispute');
  }
  return unmatched(`unrecognised ${txn.type} transaction`);
};

export const toUpsert = (
  provider: string,
  txn: ProviderBalanceTransaction,
  match: MatchResult,
  extra: { account?: string | null; payoutReference?: string | null } = {}
): BalanceTransactionUpsert => ({
  provider,
  reference: txn.reference,
  account: extra.account ?? null,
  type: txn.type,
  reportingCategory: txn.reportingCategory,
  amountCents: txn.amountCents,
  feeCents: txn.feeCents,
  netCents: txn.netCents,
  currency: txn.currency,
  status: txn.status,
  providerCreatedAt: txn.createdAt,
  availableOn: txn.availableOn,
  description: txn.description,
  sourceReference: txn.sourceReference,
  sourceType: txn.sourceType,
  paymentReference: txn.paymentReference,
  transferReference: txn.transferReference,
  payoutReference: extra.payoutReference ?? null,
  feeDetails: txn.feeDetails.map((detail) => ({ ...detail })),
  ...match
});

/** Reads every page of a provider listing (bounded by `maxPages`). */
export const readAllPages = <A extends { reference: string }, E, R>(
  page: (
    startingAfter: string | null
  ) => Effect.Effect<{ data: ReadonlyArray<A>; hasMore: boolean }, E, R>,
  maxPages: number
) =>
  Effect.gen(function* () {
    const rows: Array<A> = [];
    let cursor: string | null = null;
    let pages = 0;
    while (pages < maxPages) {
      const result: { data: ReadonlyArray<A>; hasMore: boolean } = yield* page(cursor);
      pages += 1;
      rows.push(...result.data);
      const last = result.data.at(-1);
      if (!result.hasMore || !last) return { rows, pages, complete: true };
      cursor = last.reference;
    }
    return { rows, pages, complete: false };
  });

export type ReconciliationDeps = Payments | ReconciliationRepo | CardDisputeLedger;

export type ReconciliationSummary = {
  run: ReconciliationRun;
  imported: number;
  matched: number;
  unmatched: number;
  payoutsExact: number;
};

/** Matches the transfers an automatic payout paid out, exactly. Resolves
 * how many transfers moved, or null when the payout can't be listed (a
 * manual payout, a provider error): the approximate match stands. */
export const matchPayoutExactly = (
  account: string,
  payout: ProviderPayout,
  maxPages: number,
  pageSize: number
) =>
  Effect.gen(function* () {
    if (payout.status !== 'paid' || payout.automatic === false) return null;
    const payments = yield* Payments;
    const listed = yield* readAllPages(
      (startingAfter) =>
        payments.listBalanceTransactions({
          account,
          payout: payout.reference,
          startingAfter,
          limit: pageSize
        }),
      maxPages
    ).pipe(Effect.either);
    if (Either.isLeft(listed)) {
      yield* Effect.logWarning(
        `[reconciliation] payout ${payout.reference} on ${account} can't be listed; approximate match kept`,
        listed.left
      );
      return null;
    }
    const references = [
      ...new Set(
        listed.right.rows.flatMap((txn) => (txn.transferReference ? [txn.transferReference] : []))
      )
    ];
    const moved = yield* (yield* ReconciliationRepo).markTransfersPaidExactly({
      transferReferences: references,
      payoutReference: payout.reference,
      paidAt: payout.arrivalDate ?? payout.createdAt
    });
    return { moved, references, transactions: listed.right.rows };
  });

/** One reconciliation run over `[from, to)`. Fails with
 * `ReconciliationBusyError` while another run is in progress. */
export const runReconciliation = (input: {
  trigger: 'schedule' | 'manual';
  requestedByUserId: string | null;
  from: Date;
  to: Date;
  now: Date;
}): Effect.Effect<
  ReconciliationSummary,
  ReconciliationBusyError | SqlError | import('effect/ConfigError').ConfigError,
  ReconciliationDeps
> =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const repo = yield* ReconciliationRepo;
    const disputes = yield* CardDisputeLedger;
    const config = yield* reconciliationConfig;
    const provider = payments.provider;
    const run = yield* repo.startRun({
      provider,
      trigger: input.trigger,
      requestedByUserId: input.requestedByUserId,
      periodFrom: input.from,
      periodTo: input.to,
      startedAt: input.now,
      staleBefore: new Date(input.now.getTime() - STALE_RUN_MS)
    });
    if (!run) return yield* Effect.fail(new ReconciliationBusyError());

    const body = Effect.gen(function* () {
      // 1. The platform's balance transactions, every page.
      const listed = yield* readAllPages(
        (startingAfter) =>
          payments.listBalanceTransactions({
            createdFrom: input.from,
            createdTo: input.to,
            startingAfter,
            limit: config.pageSize
          }),
        config.maxPages
      );
      const txns = listed.rows;
      const lookups = yield* repo.lookups({
        paymentReferences: txns.flatMap((txn) =>
          txn.paymentReference ? [txn.paymentReference] : []
        ),
        refundReferences: txns.flatMap((txn) =>
          txn.sourceReference?.startsWith('re_') || txn.sourceType === 'refund'
            ? [txn.sourceReference!]
            : []
        ),
        transferReferences: txns.flatMap((txn) =>
          txn.type === 'transfer' && txn.sourceReference ? [txn.sourceReference] : []
        )
      });
      const rows: Array<BalanceTransactionUpsert> = [];
      for (const txn of txns) {
        const dispute =
          txn.sourceType === 'dispute' && txn.sourceReference
            ? yield* disputes.findByProviderReference(txn.sourceReference)
            : null;
        rows.push(toUpsert(provider, txn, matchBalanceTransaction(txn, lookups, dispute)));
      }

      // 2. Helper payouts: exact where the payout can be listed.
      let payoutsExact = 0;
      const accounts = yield* repo.listPayoutAccountsWithTransfers({
        from: input.from,
        to: input.to
      });
      for (const account of accounts) {
        const payouts = yield* readAllPages(
          (startingAfter) =>
            payments.listPayouts({
              account: account.accountReference,
              createdFrom: input.from,
              createdTo: new Date(input.to.getTime() + 14 * 86_400_000),
              startingAfter,
              limit: config.pageSize
            }),
          config.maxPages
        ).pipe(Effect.either);
        if (Either.isLeft(payouts)) {
          yield* Effect.logWarning(
            `[reconciliation] payouts of ${account.accountReference} unavailable`,
            payouts.left
          );
          continue;
        }
        for (const payout of payouts.right.rows) {
          const exact = yield* matchPayoutExactly(
            account.accountReference,
            payout,
            config.maxPages,
            config.pageSize
          );
          if (!exact) continue;
          payoutsExact += exact.moved;
          // The arrivals (and the payout itself) on the helper's account,
          // stored for the trail; they are ours by construction.
          for (const txn of exact.transactions) {
            rows.push(
              toUpsert(
                provider,
                txn,
                txn.type === 'payout'
                  ? {
                      matchStatus: 'matched',
                      matchKind: 'helper_payout',
                      matchedId: null,
                      matchNote: null
                    }
                  : txn.transferReference
                    ? {
                        matchStatus: 'matched',
                        matchKind: 'transfer_arrival',
                        matchedId: txn.transferReference,
                        matchNote: null
                      }
                    : unmatched(`unrecognised ${txn.type} on a helper's account`),
                { account: account.accountReference, payoutReference: payout.reference }
              )
            );
          }
        }
      }

      yield* repo.upsertTransactions(run.id, rows);
      const matchedCount = rows.filter((row) => row.matchStatus === 'matched').length;
      const finished = yield* repo.finishRun(run.id, {
        status: listed.complete ? 'succeeded' : 'incomplete',
        importedCount: rows.length,
        matchedCount,
        unmatchedCount: rows.length - matchedCount,
        payoutsExactCount: payoutsExact,
        pages: listed.pages,
        error: listed.complete ? null : `stopped after ${listed.pages} pages`,
        finishedAt: new Date()
      });
      return {
        run: finished ?? run,
        imported: rows.length,
        matched: matchedCount,
        unmatched: rows.length - matchedCount,
        payoutsExact
      };
    });

    return yield* body.pipe(
      Effect.catchAll((error: SqlError | PaymentProviderError) =>
        repo
          .finishRun(run.id, {
            status: 'failed',
            importedCount: 0,
            matchedCount: 0,
            unmatchedCount: 0,
            payoutsExactCount: 0,
            pages: 0,
            error:
              error._tag === 'PaymentProviderError'
                ? `provider: ${String(error.cause)}`
                : 'database error',
            finishedAt: new Date()
          })
          .pipe(
            Effect.flatMap((failed) =>
              Effect.succeed({
                run: failed ?? run,
                imported: 0,
                matched: 0,
                unmatched: 0,
                payoutsExact: 0
              })
            )
          )
      )
    );
  });

/** The worker's step: a scheduled run over the lookback window once the
 * last scheduled one is `RECONCILIATION_INTERVAL_HOURS` old. Null when not
 * due (or another run is in progress). */
export const runScheduledReconciliation = (now: Date) =>
  Effect.gen(function* () {
    const config = yield* reconciliationConfig;
    const payments = yield* Payments;
    const last = yield* (yield* ReconciliationRepo).lastRun(payments.provider, 'schedule');
    const wait =
      last?.status === 'failed'
        ? Math.min(FAILED_RUN_RETRY_MS, config.intervalHours * 3600_000)
        : config.intervalHours * 3600_000;
    if (last && now.getTime() - last.startedAt.getTime() < wait) return null;
    return yield* runReconciliation({
      trigger: 'schedule',
      requestedByUserId: null,
      from: new Date(now.getTime() - config.lookbackDays * 86_400_000),
      to: now,
      now
    }).pipe(Effect.catchTag('ReconciliationBusyError', () => Effect.succeed(null)));
  });

// ---------------------------------------------------------------------------
// The accountant's view of a period

export type ReconciliationItem = {
  /** `txn:<row id>` (stable across re-imports) or `<kind>:<id>` for our
   * side — the audit entity id of its resolution. */
  key: string;
  side: 'provider' | 'ours';
  kind: string;
  reference: string | null;
  amountCents: number;
  feeCents: number;
  occurredAt: Date;
  /** matched | unmatched | mismatch, or `resolved` once the accountant
   * resolved an unmatched or mismatched item. */
  status: BalanceTransactionMatchStatus | 'resolved';
  matchKind: BalanceTransactionMatchKind | null;
  matchedId: string | null;
  note: string | null;
  account: string | null;
  payoutReference: string | null;
  resolution: { at: Date; actorUserId: string | null; note: string | null } | null;
};

export const providerItem = (row: ProviderBalanceTransactionRow): ReconciliationItem => ({
  key: `txn:${row.id}`,
  side: 'provider',
  kind: row.type,
  reference: row.reference,
  amountCents: row.amountCents,
  feeCents: row.feeCents,
  occurredAt: row.providerCreatedAt,
  status: row.matchStatus,
  matchKind: row.matchKind,
  matchedId: row.matchedId,
  note: row.matchNote,
  account: row.account,
  payoutReference: row.payoutReference,
  resolution: null
});

/** Our records of the period the provider's imported transactions don't
 * cover (by reference). */
export const unmatchedOurs = (
  ours: ReconciliationLookups,
  imported: ReadonlyArray<ProviderBalanceTransactionRow>
): Array<ReconciliationItem> => {
  const seen = new Set(
    imported.flatMap(
      (row) => [row.paymentReference, row.sourceReference].filter(Boolean) as string[]
    )
  );
  const item = (
    kind: string,
    id: string,
    reference: string | null,
    amountCents: number,
    occurredAt: Date | null
  ): ReconciliationItem => ({
    key: `${kind}:${id}`,
    side: 'ours',
    kind,
    reference,
    amountCents,
    feeCents: 0,
    occurredAt: occurredAt ?? new Date(0),
    status: 'unmatched',
    matchKind: null,
    matchedId: id,
    note: 'not found in the provider’s balance transactions for the period',
    account: null,
    payoutReference: null,
    resolution: null
  });
  return [
    ...ours.payments
      .filter(
        (row) =>
          row.capturedAt !== null && row.providerReference && !seen.has(row.providerReference)
      )
      .map((row) =>
        item(
          'payment',
          row.id,
          row.providerReference,
          row.capturedCents ?? row.totalCents,
          row.capturedAt
        )
      ),
    ...ours.payments
      .filter(
        (row) => row.status === 'refunded' && row.refundReference && !seen.has(row.refundReference)
      )
      .map((row) =>
        item(
          'payment_refund',
          row.id,
          row.refundReference,
          -(row.capturedCents ?? row.totalCents),
          row.refundedAt
        )
      ),
    ...ours.refunds
      .filter((row) => row.providerReference && !seen.has(row.providerReference))
      .map((row) =>
        item('session_refund', row.id, row.providerReference, -row.totalCents, row.refundedAt)
      ),
    ...ours.transfers
      .filter((row) => row.providerReference && !seen.has(row.providerReference))
      .map((row) =>
        item('helper_transfer', row.id, row.providerReference, -(row.amountCents ?? 0), row.sentAt)
      )
  ];
};
