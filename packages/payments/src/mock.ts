import { Context, Effect, Layer } from 'effect';
import {
  PaymentDeclinedError,
  PaymentProviderError,
  PaymentWebhookSignatureError,
  Payments,
  quoteFromPolicy,
  type CardDetails,
  type PaymentOperation,
  type PaymentRefund,
  type ProviderCardSetup,
  type CreateRefundInput,
  type CreateTransferInput,
  type ProviderBalanceTransaction,
  type ProviderPage,
  type ProviderPayout,
  type ProviderRefund,
  type ProviderRefundStatus,
  type ProviderTransfer,
  type TransferResult,
  type ChargeSavedCardInput,
  type ProviderPayment,
  type StartPaymentInput
} from './port';

/** How long a provider remembers an idempotency key (Stripe: 24 h). */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The mock, plus every intent it holds (for assertions). */
export type MockPayments = Context.Tag.Service<Payments> & {
  intents: () => ReadonlyArray<ProviderPayment>;
  /** Every partial refund made (for assertions). */
  refunds: () => ReadonlyArray<ProviderRefund>;
  /** Every transfer made (for assertions). */
  transfers: () => ReadonlyArray<ProviderTransfer>;
  /** Sets a refund's state, as the provider would later (a failure). */
  settleRefund: (reference: string, status: ProviderRefundStatus, reason?: string) => void;
  /** Puts a connected account's payout on file (payout events). */
  setPayout: (account: string, payout: ProviderPayout) => void;
  /** Tier 3 step 5: the balance transactions the provider lists for the
   * platform (`null`) or a connected account. */
  setBalanceTransactions: (
    account: string | null,
    transactions: ReadonlyArray<ProviderBalanceTransaction>
  ) => void;
  /** What an automatic payout paid out (its `payout=` listing). */
  setPayoutTransactions: (
    account: string,
    payout: string,
    transactions: ReadonlyArray<ProviderBalanceTransaction>
  ) => void;
};

/** Newest first, like the provider; `startingAfter` continues after that
 * reference; `limit` per page. */
const pageOf = <A>(
  rows: ReadonlyArray<A>,
  referenceOf: (row: A) => string,
  startingAfter: string | null | undefined,
  limit: number
): ProviderPage<A> => {
  const start = startingAfter ? rows.findIndex((row) => referenceOf(row) === startingAfter) + 1 : 0;
  const data = rows.slice(start, start + limit);
  return { data, hasMore: start + limit < rows.length };
};

const inRange = (at: Date, from: Date | undefined, to: Date | undefined) =>
  (from === undefined || at >= from) && (to === undefined || at < to);

const sameCharge = (a: ChargeSavedCardInput, b: ChargeSavedCardInput) =>
  a.amountCents === b.amountCents &&
  a.currency === b.currency &&
  a.customer === b.customer &&
  a.card === b.card &&
  a.capture === b.capture &&
  JSON.stringify(a.metadata) === JSON.stringify(b.metadata);

/** The card every mock setup and mock payment "uses". */
export const mockCard = (reference: string): CardDetails => ({
  reference,
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2034
});

/**
 * Mock provider.
 *
 * Payments succeed the moment they start and card setups succeed immediately
 * with a fake Visa •••• 4242, so the whole flow runs without a provider.
 * `failStart` and `failRefund` exist so the decline and refund paths can be
 * exercised — those are exactly the paths that are painful to test once money
 * is real. `verifyWebhook` accepts nothing: the mock has no webhooks.
 */
export const makeMockPayments = (
  options: {
    failStart?: boolean;
    failRefund?: boolean;
    /** Off-session charges and captures fail as if the provider were down. */
    providerDown?: boolean;
    /** The off-session charge goes through, but its response never comes
     * back (a timeout after the provider acted). */
    loseResponses?: () => boolean;
    /** Search is eventually consistent: an intent younger than this is not
     * found by `findPaymentByRowId` yet. */
    searchLagMs?: number;
    /** The state a new partial refund is created in (default succeeded). */
    refundOutcome?: (input: CreateRefundInput) => ProviderRefundStatus;
    /** A refund the provider refuses (the reason), or null to accept. */
    refundRefusal?: (input: CreateRefundInput) => string | null;
    /** A transfer the provider refuses (the reason), or null to accept. */
    transferRefusal?: (input: CreateTransferInput) => string | null;
    /** Refunds and transfers fail as if the provider were down. */
    moneyDown?: () => boolean;
    now?: () => Date;
  } = {}
): MockPayments => {
  const now = options.now ?? (() => new Date());
  const started = new Map<string, { input: StartPaymentInput; reference: string }>();
  const charges = new Map<string, { input: ChargeSavedCardInput; reference: string; at: Date }>();
  const createdAt = new Map<string, Date>();
  const byReference = new Map<string, ProviderPayment>();
  const refunds = new Map<string, PaymentRefund>();
  const setups = new Map<string, ProviderCardSetup>();
  const partialRefunds = new Map<string, ProviderRefund>();
  const refundKeys = new Map<string, string>();
  const transfers = new Map<string, ProviderTransfer>();
  const transferKeys = new Map<string, string>();
  const payouts = new Map<string, ProviderPayout>();
  const balanceTransactions = new Map<string, ReadonlyArray<ProviderBalanceTransaction>>();
  const payoutTransactions = new Map<string, ReadonlyArray<ProviderBalanceTransaction>>();
  const newestFirst = <A extends { createdAt: Date; reference: string }>(rows: ReadonlyArray<A>) =>
    [...rows].sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || b.reference.localeCompare(a.reference)
    );
  const down = (operation: PaymentOperation) =>
    options.moneyDown?.() || options.providerDown
      ? Effect.fail(new PaymentProviderError({ operation, cause: 'mock provider down' }))
      : null;

  /** The provider's answer — or, when responses are being lost, nothing. */
  const answer = (payment: ProviderPayment) =>
    options.loseResponses?.()
      ? Effect.fail(
          new PaymentProviderError({ operation: 'chargeSavedCard', cause: 'mock: response lost' })
        )
      : Effect.succeed(payment);

  const unknown = (operation: PaymentOperation, reference: string) =>
    Effect.fail(
      new PaymentProviderError({ operation, cause: `mock: unknown reference ${reference}` })
    );

  return {
    provider: 'mock',

    quote: (lineItems, policy) => Effect.succeed(quoteFromPolicy(lineItems, policy)),

    startPayment: (input) =>
      Effect.gen(function* () {
        if (options.failStart) {
          return yield* Effect.fail(new PaymentDeclinedError({ reason: 'mock decline' }));
        }
        // Idempotency is part of the contract, not an implementation detail —
        // the mock has to honour it or the retry path tests nothing.
        const existing = started.get(input.idempotencyKey);
        const reference = existing?.reference ?? `mock_pi_${input.idempotencyKey}`;
        if (!existing) {
          started.set(input.idempotencyKey, { input, reference });
          byReference.set(reference, {
            reference,
            status: 'succeeded',
            amountCents: input.quote.totalCents,
            currency: input.quote.currency.toLowerCase(),
            metadata: { ...input.metadata },
            customer: input.customer ?? null,
            savesCard: input.saveCard,
            failureReason: null,
            receiptUrl: null,
            refundedCents: 0,
            paymentMethod: mockCard(input.savedCard ?? `mock_pm_${input.idempotencyKey}`),
            capturableCents: 0,
            receivedCents: input.quote.totalCents,
            captureBefore: null,
            chargeReference: `mock_ch_${input.idempotencyKey}`
          });
        }
        return {
          reference,
          clientSecret: `mock_secret_${reference}`,
          status: 'succeeded' as const,
          paymentMethodReference: input.savedCard ?? null
        };
      }),

    resumePayment: (reference) => {
      const payment = byReference.get(reference);
      return payment
        ? Effect.succeed({
            reference,
            clientSecret: `mock_secret_${reference}`,
            status: payment.status,
            paymentMethodReference: payment.paymentMethod?.reference ?? null
          })
        : unknown('resumePayment', reference);
    },

    getPayment: (reference) => {
      const payment = byReference.get(reference);
      return payment ? Effect.succeed(payment) : unknown('getPayment', reference);
    },

    cancelPayment: (reference) => {
      const payment = byReference.get(reference);
      if (!payment) return unknown('cancelPayment', reference);
      if (payment.status === 'succeeded') return Effect.succeed(payment);
      const canceled = { ...payment, status: 'canceled' as const, capturableCents: 0 };
      byReference.set(reference, canceled);
      return Effect.succeed(canceled);
    },

    refund: ({ reference, idempotencyKey }) =>
      Effect.gen(function* () {
        if (options.failRefund) {
          return yield* Effect.fail(
            new PaymentProviderError({ operation: 'refund', cause: 'mock refund failure' })
          );
        }
        const existing = refunds.get(idempotencyKey);
        if (existing) {
          return existing;
        }
        const refund: PaymentRefund = {
          refundReference: `mock_refund_${reference}`,
          refundedAt: now()
        };
        refunds.set(idempotencyKey, refund);
        return refund;
      }),

    ensureCustomer: ({ userId, existing }) => Effect.succeed(existing ?? `mock_cus_${userId}`),

    startCardSetup: (customer) => {
      const reference = `mock_seti_${setups.size + 1}`;
      setups.set(reference, {
        reference,
        status: 'succeeded',
        customer,
        paymentMethod: mockCard(`mock_pm_${reference}`)
      });
      return Effect.succeed({ reference, clientSecret: `mock_secret_${reference}` });
    },

    getCardSetup: (reference) => {
      const setup = setups.get(reference);
      return setup ? Effect.succeed(setup) : unknown('getCardSetup', reference);
    },

    removeCard: () => Effect.void,

    // Off-session contract billing. A saved card whose reference contains
    // `decline` is refused — the only way to reach the decline paths without
    // a provider. Same key + same input within 24 h → the first answer (a
    // replay); same key + different input → an idempotency refusal; a key
    // older than 24 h is forgotten, as Stripe forgets it.
    chargeSavedCard: (input) =>
      Effect.suspend(() => {
        if (options.providerDown) {
          return Effect.fail(
            new PaymentProviderError({ operation: 'chargeSavedCard', cause: 'mock provider down' })
          );
        }
        const at = now();
        const existing = charges.get(input.idempotencyKey);
        const remembered =
          existing && at.getTime() - existing.at.getTime() < IDEMPOTENCY_WINDOW_MS
            ? existing
            : null;
        if (remembered) {
          if (!sameCharge(remembered.input, input)) {
            return Effect.fail(
              new PaymentProviderError({
                operation: 'chargeSavedCard',
                cause: `mock: key ${input.idempotencyKey} reused with different parameters`,
                idempotency: 'mismatch'
              })
            );
          }
          return answer(byReference.get(remembered.reference)!);
        }
        const reference = existing
          ? `mock_pi_${input.idempotencyKey}_${byReference.size + 1}`
          : `mock_pi_${input.idempotencyKey}`;
        const declined = input.card.includes('decline');
        const payment: ProviderPayment = {
          reference,
          status: declined ? 'failed' : input.capture === 'manual' ? 'authorised' : 'succeeded',
          amountCents: input.amountCents,
          currency: input.currency.toLowerCase(),
          metadata: { ...input.metadata },
          customer: input.customer,
          savesCard: false,
          failureReason: declined ? 'Your card was declined.' : null,
          receiptUrl: null,
          refundedCents: 0,
          paymentMethod: mockCard(input.card),
          capturableCents: !declined && input.capture === 'manual' ? input.amountCents : 0,
          receivedCents: !declined && input.capture === 'automatic' ? input.amountCents : 0,
          captureBefore:
            input.capture === 'manual' ? new Date(at.getTime() + 114 * 60 * 60 * 1000) : null,
          chargeReference: declined ? null : `mock_ch_${reference}`
        };
        charges.set(input.idempotencyKey, { input, reference, at });
        createdAt.set(reference, at);
        byReference.set(reference, payment);
        return answer(payment);
      }),

    capturePayment: ({ reference, amountCents }) =>
      Effect.suspend(() => {
        if (options.providerDown) {
          return Effect.fail(
            new PaymentProviderError({ operation: 'capturePayment', cause: 'mock provider down' })
          );
        }
        const payment = byReference.get(reference);
        if (!payment) return unknown('capturePayment', reference);
        if (payment.status === 'succeeded') return Effect.succeed(payment);
        if (payment.status !== 'authorised') {
          return Effect.fail(
            new PaymentProviderError({
              operation: 'capturePayment',
              cause: `mock: ${reference} is ${payment.status}, not capturable`
            })
          );
        }
        const captured: ProviderPayment = {
          ...payment,
          status: 'succeeded',
          chargeReference: payment.chargeReference ?? `mock_ch_${reference}`,
          capturableCents: 0,
          receivedCents: Math.min(amountCents, payment.capturableCents)
        };
        byReference.set(reference, captured);
        return Effect.succeed(captured);
      }),

    findPaymentByRowId: (paymentId) =>
      options.providerDown
        ? Effect.fail(
            new PaymentProviderError({
              operation: 'findPaymentByRowId',
              cause: 'mock provider down'
            })
          )
        : Effect.sync(
            () =>
              [...byReference.values()].find(
                (payment) =>
                  payment.metadata.payment_id === paymentId &&
                  // Not indexed yet: search lags behind creation.
                  now().getTime() - (createdAt.get(payment.reference) ?? new Date(0)).getTime() >=
                    (options.searchLagMs ?? 0)
              ) ?? null
          ),

    // Partial refunds (Tier 3 step 2): several per intent, never above what
    // it received; same key → the same refund.
    createRefund: (input) =>
      Effect.suspend(() => {
        const failure = down('createRefund');
        if (failure) return failure;
        if (options.failRefund) {
          return Effect.fail(
            new PaymentProviderError({ operation: 'createRefund', cause: 'mock refund failure' })
          );
        }
        const known = refundKeys.get(input.idempotencyKey);
        if (known) return Effect.succeed(partialRefunds.get(known)!);
        const refusal = options.refundRefusal?.(input) ?? null;
        if (refusal) {
          return Effect.fail(
            new PaymentProviderError({ operation: 'createRefund', cause: refusal, refusal })
          );
        }
        const payment = byReference.get(input.paymentReference);
        if (!payment) return unknown('createRefund', input.paymentReference);
        const refunded = [...partialRefunds.values()]
          .filter(
            (r) =>
              r.paymentReference === input.paymentReference &&
              r.status !== 'failed' &&
              r.status !== 'canceled'
          )
          .reduce((t, r) => t + r.amountCents, 0);
        if (refunded + input.amountCents > payment.receivedCents) {
          const reason = `mock: refund of ${input.amountCents} exceeds what is left on ${input.paymentReference}`;
          return Effect.fail(
            new PaymentProviderError({ operation: 'createRefund', cause: reason, refusal: reason })
          );
        }
        const status = options.refundOutcome?.(input) ?? 'succeeded';
        const refund: ProviderRefund = {
          reference: `mock_re_${partialRefunds.size + 1}`,
          status,
          amountCents: input.amountCents,
          paymentReference: input.paymentReference,
          metadata: { ...input.metadata },
          failureReason: status === 'failed' ? 'mock: refund failed' : null,
          createdAt: now()
        };
        partialRefunds.set(refund.reference, refund);
        refundKeys.set(input.idempotencyKey, refund.reference);
        byReference.set(input.paymentReference, {
          ...payment,
          refundedCents: payment.refundedCents + (status === 'failed' ? 0 : input.amountCents)
        });
        return Effect.succeed(refund);
      }),

    getRefund: (reference) => {
      const refund = partialRefunds.get(reference);
      return refund ? Effect.succeed(refund) : unknown('getRefund', reference);
    },

    createTransfer: (input) =>
      Effect.suspend((): Effect.Effect<TransferResult, PaymentProviderError> => {
        const failure = down('createTransfer');
        if (failure) return failure;
        const known = transferKeys.get(input.idempotencyKey);
        if (known)
          return Effect.succeed({ status: 'created' as const, transfer: transfers.get(known)! });
        const refused = options.transferRefusal?.(input) ?? null;
        if (refused) return Effect.succeed({ status: 'refused' as const, reason: refused });
        if (input.sourceTransaction !== null) {
          // Like Stripe: transfers from a charge never exceed what it took
          // minus its refunds and the earlier transfers from it.
          const source = [...byReference.values()].find(
            (payment) => payment.chargeReference === input.sourceTransaction
          );
          const earlier = [...transfers.values()]
            .filter((transfer) => transfer.sourceTransaction === input.sourceTransaction)
            .reduce((total, transfer) => total + transfer.amountCents, 0);
          const left = source ? source.receivedCents - source.refundedCents - earlier : 0;
          if (input.amountCents > left) {
            return Effect.succeed({
              status: 'refused' as const,
              reason: `Transfers using this transaction as a source must not exceed the source amount (${left} left)`
            });
          }
        }
        const transfer: ProviderTransfer = {
          reference: `mock_tr_${transfers.size + 1}`,
          amountCents: input.amountCents,
          destination: input.destination,
          sourceTransaction: input.sourceTransaction,
          metadata: { ...input.metadata },
          reversedCents: 0,
          createdAt: now()
        };
        transfers.set(transfer.reference, transfer);
        transferKeys.set(input.idempotencyKey, transfer.reference);
        return Effect.succeed({ status: 'created' as const, transfer });
      }),

    getTransfer: (reference) => {
      const transfer = transfers.get(reference);
      return transfer ? Effect.succeed(transfer) : unknown('getTransfer', reference);
    },

    getPayout: ({ account, reference }) => {
      const payout = payouts.get(`${account}/${reference}`);
      return payout ? Effect.succeed(payout) : unknown('getPayout', reference);
    },

    listBalanceTransactions: (input) => {
      const failure = down('listBalanceTransactions');
      if (failure) return failure;
      if (input.payout !== undefined) {
        const account = input.account ?? '';
        if (payouts.get(`${account}/${input.payout}`)?.automatic === false) {
          // Stripe: "Balance transaction history can only be filtered on
          // automatic transfers, not manual."
          return Effect.fail(
            new PaymentProviderError({
              operation: 'listBalanceTransactions',
              cause: 'mock: a manual payout cannot be filtered'
            })
          );
        }
        const rows = payoutTransactions.get(`${account}/${input.payout}`);
        if (!rows) return unknown('listBalanceTransactions', input.payout);
        return Effect.succeed(
          pageOf(newestFirst(rows), (row) => row.reference, input.startingAfter, input.limit)
        );
      }
      const rows = newestFirst(balanceTransactions.get(input.account ?? '') ?? []).filter((row) =>
        inRange(row.createdAt, input.createdFrom, input.createdTo)
      );
      return Effect.succeed(pageOf(rows, (row) => row.reference, input.startingAfter, input.limit));
    },

    listPayouts: (input) => {
      const failure = down('listPayouts');
      if (failure) return failure;
      const rows = newestFirst(
        [...payouts.entries()]
          .filter(([key]) => key.startsWith(`${input.account}/`))
          .map(([, payout]) => payout)
      ).filter((payout) => inRange(payout.createdAt, input.createdFrom, input.createdTo));
      return Effect.succeed(pageOf(rows, (row) => row.reference, input.startingAfter, input.limit));
    },

    // Payout accounts: enabled straight away, so the whole helper flow runs
    // without Stripe. The "hosted onboarding" is the return page itself.
    createPayoutAccount: ({ userId }) => Effect.succeed({ reference: `mock_acct_${userId}` }),

    createOnboardingLink: ({ returnUrl }) =>
      Effect.sync(() => ({
        url: returnUrl,
        expiresAt: new Date(now().getTime() + 5 * 60 * 1000)
      })),

    getPayoutAccount: () =>
      Effect.succeed({
        detailsSubmitted: true,
        payoutsEnabled: true,
        transfersActive: true,
        requirementsDue: [],
        disabledReason: null
      }),

    createDashboardLink: () => Effect.succeed({ url: 'about:blank' }),

    verifyWebhook: () =>
      Effect.fail(
        new PaymentWebhookSignatureError({ reason: 'the mock provider has no webhooks' })
      ),

    intents: () => [...byReference.values()],
    refunds: () => [...partialRefunds.values()],
    transfers: () => [...transfers.values()],
    settleRefund: (reference, status, reason) => {
      const refund = partialRefunds.get(reference);
      if (refund) {
        partialRefunds.set(reference, {
          ...refund,
          status,
          failureReason: status === 'failed' ? (reason ?? 'mock: refund failed') : null
        });
      }
    },
    setPayout: (account, payout) => {
      payouts.set(`${account}/${payout.reference}`, payout);
    },
    setBalanceTransactions: (account, transactions) => {
      balanceTransactions.set(account ?? '', transactions);
    },
    setPayoutTransactions: (account, payout, transactions) => {
      payoutTransactions.set(`${account}/${payout}`, transactions);
    }
  };
};

export const PaymentsMock = Layer.sync(Payments, () => makeMockPayments());

export const makePaymentsTest = (implementation: Partial<Context.Tag.Service<Payments>>) =>
  Layer.succeed(Payments, { ...makeMockPayments(), ...implementation });
