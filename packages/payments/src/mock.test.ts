import { describe, expect, it } from 'bun:test';
import { Effect, Exit } from 'effect';
import { makeMockPayments } from './mock';
import { describeQuote, quoteFromPolicy } from './port';

const quote = quoteFromPolicy([{ label: 'Check', costCents: 4500 }], {
  adminFeeCents: 500,
  taxLines: []
});

const hst = (supplyType: string, baseCents: number, taxCents: number) => ({
  supplyType,
  jurisdiction: 'ON',
  component: 'hst',
  rateMillipercent: 13000,
  baseCents,
  taxCents,
  label: 'HST (ON) 13%',
  registrationNumber: 'PLACEHOLDER-1'
});

describe('quoteFromPolicy', () => {
  it('adds the fee and the frozen tax lines, in integer cents', () => {
    const taxed = quoteFromPolicy([{ label: 'Check', costCents: 4500 }], {
      adminFeeCents: 500,
      taxLines: [hst('credibled_check', 4500, 585), hst('credibled_admin_fee', 500, 65)]
    });
    expect(taxed).toMatchObject({
      amountCents: 4500,
      feeCents: 500,
      taxCents: 650,
      totalCents: 5650
    });
    expect(taxed.taxLines).toHaveLength(2);
  });

  it('charges nothing at all for an empty basket', () => {
    const empty = quoteFromPolicy([], { adminFeeCents: 500, taxLines: [hst('x', 500, 65)] });
    expect(empty.totalCents).toBe(0);
    expect(empty.taxLines).toEqual([]);
  });

  it('describes the quote for the receipt, tax lines by label', () => {
    const taxed = quoteFromPolicy([{ label: 'Check', costCents: 4500 }], {
      adminFeeCents: 500,
      taxLines: [hst('credibled_check', 4500, 585), hst('credibled_admin_fee', 500, 65)]
    });
    expect(describeQuote('Background check', taxed)).toBe(
      'Background check $45.00 · Admin fee $5.00 · HST (ON) 13% $6.50 (reg. PLACEHOLDER-1)'
    );
  });

  it('prints "reg. pending" for a line whose registration number is not final', () => {
    const taxed = quoteFromPolicy([{ label: 'Check', costCents: 4500 }], {
      adminFeeCents: 0,
      taxLines: [{ ...hst('credibled_check', 4500, 585), registrationNumber: null }]
    });
    expect(describeQuote('Background check', taxed)).toBe(
      'Background check $45.00 · HST (ON) 13% $5.85 (reg. pending)'
    );
  });
});

describe('mock payments', () => {
  it('settles a payment the moment it starts, once per key', async () => {
    const payments = makeMockPayments();
    const input = {
      quote,
      idempotencyKey: 'payment-1',
      metadata: { payment_id: 'payment-1' },
      saveCard: false
    };
    const first = await Effect.runPromise(payments.startPayment(input));
    const again = await Effect.runPromise(payments.startPayment(input));

    expect(first.status).toBe('succeeded');
    expect(first.clientSecret).toStartWith('mock_secret_');
    expect(again.reference).toBe(first.reference);

    const fetched = await Effect.runPromise(payments.getPayment(first.reference));
    expect(fetched).toMatchObject({
      status: 'succeeded',
      amountCents: 5000,
      currency: 'cad',
      metadata: { payment_id: 'payment-1' }
    });
  });

  it('completes a card setup immediately with a fake Visa 4242', async () => {
    const payments = makeMockPayments();
    const setup = await Effect.runPromise(payments.startCardSetup('mock_cus_u1'));
    const fetched = await Effect.runPromise(payments.getCardSetup(setup.reference));
    expect(fetched).toMatchObject({ status: 'succeeded', customer: 'mock_cus_u1' });
    expect(fetched.paymentMethod).toMatchObject({ brand: 'visa', last4: '4242' });
  });

  it('accepts no webhook at all', async () => {
    const exit = await Effect.runPromiseExit(makeMockPayments().verifyWebhook('{}', 't=1,v1=x'));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('declines on demand', async () => {
    const exit = await Effect.runPromiseExit(
      makeMockPayments({ failStart: true }).startPayment({
        quote,
        idempotencyKey: 'payment-1',
        metadata: { payment_id: 'payment-1' },
        saveCard: false
      })
    );
    expect(exit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: 'PaymentDeclinedError' }) as never)
    );
  });
});

describe('mock off-session billing', () => {
  const input = {
    amountCents: 10000,
    currency: 'CAD' as const,
    customer: 'mock_cus_family',
    card: 'mock_pm_1',
    capture: 'manual' as const,
    idempotencyKey: 'cycle-1-1',
    metadata: { payment_id: 'payment-1' }
  };

  it('holds, then captures part of the hold, once per key', async () => {
    const payments = makeMockPayments();
    const held = await Effect.runPromise(payments.chargeSavedCard(input));
    expect(held).toMatchObject({ status: 'authorised', capturableCents: 10000 });
    expect(await Effect.runPromise(payments.chargeSavedCard(input))).toEqual(held);
    const captured = await Effect.runPromise(
      payments.capturePayment({ reference: held.reference, amountCents: 8000, idempotencyKey: 'c' })
    );
    expect(captured).toMatchObject({
      status: 'succeeded',
      receivedCents: 8000,
      capturableCents: 0
    });
  });

  it('declines a card whose reference says so, as data', async () => {
    const payments = makeMockPayments();
    const declined = await Effect.runPromise(
      payments.chargeSavedCard({ ...input, card: 'mock_pm_decline' })
    );
    expect(declined).toMatchObject({ status: 'failed', failureReason: 'Your card was declined.' });
  });

  it('releases a hold on cancel and fails while the provider is down', async () => {
    const payments = makeMockPayments();
    const held = await Effect.runPromise(payments.chargeSavedCard(input));
    const released = await Effect.runPromise(payments.cancelPayment(held.reference));
    expect(released.status).toBe('canceled');
    const down = makeMockPayments({ providerDown: true });
    expect(Exit.isFailure(await Effect.runPromiseExit(down.chargeSavedCard(input)))).toBe(true);
  });

  it('finds the intent created for a payment row by its metadata, or nothing', async () => {
    const payments = makeMockPayments();
    expect(await Effect.runPromise(payments.findPaymentByRowId('payment-1'))).toBeNull();
    const held = await Effect.runPromise(payments.chargeSavedCard(input));
    expect(await Effect.runPromise(payments.findPaymentByRowId('payment-1'))).toEqual(held);
    const down = makeMockPayments({ providerDown: true });
    expect(Exit.isFailure(await Effect.runPromiseExit(down.findPaymentByRowId('payment-1')))).toBe(
      true
    );
  });
});

describe('mock provider trouble (R3, R4)', () => {
  const input = {
    amountCents: 13206,
    currency: 'CAD' as const,
    customer: 'mock_cus_1',
    card: 'mock_pm_old',
    capture: 'manual' as const,
    idempotencyKey: 'cycle-c1-1',
    metadata: { payment_id: 'payment-1' }
  };

  it('acts on a charge whose response it then loses, and replays the first answer', async () => {
    let lose = true;
    const payments = makeMockPayments({ loseResponses: () => lose });
    expect(Exit.isFailure(await Effect.runPromiseExit(payments.chargeSavedCard(input)))).toBe(true);
    expect(payments.intents()).toHaveLength(1);
    lose = false;
    const replayed = await Effect.runPromise(payments.chargeSavedCard(input));
    expect(replayed.status).toBe('authorised');
    expect(payments.intents()).toHaveLength(1);
  });

  it('refuses the same key with another card as an idempotency mismatch', async () => {
    const payments = makeMockPayments();
    await Effect.runPromise(payments.chargeSavedCard(input));
    const exit = await Effect.runPromiseExit(
      payments.chargeSavedCard({ ...input, card: 'mock_pm_new' })
    );
    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({ _tag: 'PaymentProviderError', idempotency: 'mismatch' }) as never
      )
    );
  });

  it('forgets a key after 24 hours, as the provider does', async () => {
    let clock = new Date('2026-11-01T00:00:00.000Z');
    const payments = makeMockPayments({ now: () => clock });
    await Effect.runPromise(payments.chargeSavedCard(input));
    clock = new Date(clock.getTime() + 24 * 60 * 60 * 1000);
    await Effect.runPromise(payments.chargeSavedCard(input));
    // A second intent: why nothing may be "retried" under an expired key.
    expect(payments.intents()).toHaveLength(2);
  });

  it('does not find a fresh intent by search until the index catches up', async () => {
    let clock = new Date('2026-11-01T00:00:00.000Z');
    const payments = makeMockPayments({ now: () => clock, searchLagMs: 60_000 });
    await Effect.runPromise(payments.chargeSavedCard(input));
    expect(await Effect.runPromise(payments.findPaymentByRowId('payment-1'))).toBeNull();
    clock = new Date(clock.getTime() + 60_000);
    expect(await Effect.runPromise(payments.findPaymentByRowId('payment-1'))).not.toBeNull();
  });
});

describe('mock partial refunds and transfers (Tier 3 step 2)', () => {
  const held = async (payments: ReturnType<typeof makeMockPayments>) => {
    const charged = await Effect.runPromise(
      payments.chargeSavedCard({
        amountCents: 13206,
        currency: 'CAD',
        customer: 'cus_1',
        card: 'pm_1',
        capture: 'automatic',
        idempotencyKey: 'cycle-1-1',
        metadata: { payment_id: 'p-1' }
      })
    );
    return charged.reference;
  };

  it('refunds part of a charge several times, never above what it received, once per key', async () => {
    const payments = makeMockPayments();
    const reference = await held(payments);
    const input = (key: string, amountCents: number) => ({
      paymentReference: reference,
      amountCents,
      idempotencyKey: key,
      metadata: { refund_id: key }
    });
    const first = await Effect.runPromise(payments.createRefund(input('r-1', 5039)));
    const again = await Effect.runPromise(payments.createRefund(input('r-1', 5039)));
    expect(again.reference).toBe(first.reference);
    await Effect.runPromise(payments.createRefund(input('r-2', 6602)));
    const over = await Effect.runPromiseExit(payments.createRefund(input('r-3', 1566)));
    expect(over._tag).toBe('Failure');
    expect((await Effect.runPromise(payments.getPayment(reference))).refundedCents).toBe(11641);
  });

  it('caps transfers from a charge at what it took minus refunds and earlier transfers', async () => {
    const payments = makeMockPayments();
    const reference = await held(payments);
    const { chargeReference } = await Effect.runPromise(payments.getPayment(reference));
    await Effect.runPromise(
      payments.createRefund({
        paymentReference: reference,
        amountCents: 6602,
        idempotencyKey: 'r',
        metadata: {}
      })
    );
    const transfer = (key: string, amountCents: number, sourceTransaction: string | null) =>
      Effect.runPromise(
        payments.createTransfer({
          amountCents,
          currency: 'CAD',
          destination: 'acct_ok',
          sourceTransaction,
          idempotencyKey: key,
          metadata: {}
        })
      );
    expect((await transfer('t-1', 5265, chargeReference)).status).toBe('created');
    expect((await transfer('t-2', 5266, chargeReference)).status).toBe('refused');
    expect((await transfer('t-3', 1339, chargeReference)).status).toBe('created');
    expect((await transfer('t-4', 5266, null)).status).toBe('created');
  });

  it('refuses a refund it is told to refuse, as a refusal', async () => {
    const payments = makeMockPayments({ refundRefusal: () => 'charge disputed' });
    const reference = await held(payments);
    const error = await Effect.runPromise(
      payments
        .createRefund({ paymentReference: reference, amountCents: 1, idempotencyKey: 'r', metadata: {} })
        .pipe(Effect.flip)
    );
    expect(error.refusal).toBe('charge disputed');
  });

  it('reaches the failure paths: a refund that fails later, a refused transfer, an outage', async () => {
    const payments = makeMockPayments({
      refundOutcome: () => 'pending',
      transferRefusal: (input) =>
        input.destination === 'acct_restricted' ? 'account restricted' : null
    });
    const reference = await held(payments);
    const refund = await Effect.runPromise(
      payments.createRefund({
        paymentReference: reference,
        amountCents: 100,
        idempotencyKey: 'r',
        metadata: {}
      })
    );
    expect(refund.status).toBe('pending');
    payments.settleRefund(refund.reference, 'failed', 'card closed');
    expect(await Effect.runPromise(payments.getRefund(refund.reference))).toMatchObject({
      status: 'failed',
      failureReason: 'card closed'
    });
    const { chargeReference } = await Effect.runPromise(payments.getPayment(reference));
    const transfer = (destination: string) =>
      Effect.runPromise(
        payments.createTransfer({
          amountCents: 500,
          currency: 'CAD',
          destination,
          sourceTransaction: chargeReference,
          idempotencyKey: `t-${destination}`,
          metadata: {}
        })
      );
    expect(await transfer('acct_restricted')).toEqual({
      status: 'refused',
      reason: 'account restricted'
    });
    expect((await transfer('acct_ok')).status).toBe('created');
    expect(payments.transfers()).toHaveLength(1);
    const down = makeMockPayments({ moneyDown: () => true });
    const exit = await Effect.runPromiseExit(
      down.createTransfer({
        amountCents: 1,
        currency: 'CAD',
        destination: 'a',
        sourceTransaction: null,
        idempotencyKey: 'x',
        metadata: {}
      })
    );
    expect(exit._tag).toBe('Failure');
  });
});

describe('card disputes on the mock (Tier 3 step 4)', () => {
  const charged = async () => {
    const payments = makeMockPayments();
    const payment = await Effect.runPromise(
      payments.chargeSavedCard({
        amountCents: 13206,
        currency: 'CAD',
        customer: 'mock_cus_1',
        card: 'mock_pm_ok',
        capture: 'automatic',
        idempotencyKey: 'charge-1',
        metadata: { payment_id: 'payment-1' }
      })
    );
    return { payments, payment };
  };

  it('opens a dispute that withdraws the charge with the fee and blocks refunds', async () => {
    const { payments, payment } = await charged();
    const dispute = payments.openDispute(payment.reference);
    expect(dispute).toMatchObject({
      status: 'needs_response',
      amountCents: 13206,
      paymentReference: payment.reference,
      chargeRefundable: false,
      balanceTransactions: [{ kind: 'withdrawal', amountCents: 13206, feeCents: 1500 }]
    });
    const refused = await Effect.runPromise(
      payments
        .createRefund({
          paymentReference: payment.reference,
          amountCents: 100,
          idempotencyKey: 'r-1',
          metadata: {}
        })
        .pipe(Effect.flip)
    );
    expect(refused.refusal).toContain('charge_disputed');
  });

  it('an inquiry takes no money and leaves the charge refundable', async () => {
    const { payments, payment } = await charged();
    const inquiry = payments.openDispute(payment.reference, { inquiry: true });
    expect(inquiry).toMatchObject({
      status: 'warning_needs_response',
      chargeRefundable: true,
      balanceTransactions: []
    });
  });

  it('stages and submits evidence within the limits; refuses more, or after submitting', async () => {
    const { payments, payment } = await charged();
    const { reference } = payments.openDispute(payment.reference);
    const staged = await Effect.runPromise(
      payments.updateDisputeEvidence({
        reference,
        text: { uncategorized_text: 'draft' },
        files: {},
        submit: false
      })
    );
    expect(staged).toMatchObject({ status: 'needs_response', hasEvidence: true, submissionCount: 0 });
    const tooLong = await Effect.runPromise(
      payments
        .updateDisputeEvidence({
          reference,
          text: { service_date: 'x'.repeat(5001) },
          files: {},
          submit: true
        })
        .pipe(Effect.flip)
    );
    expect(tooLong.refusal).toContain('at most 5000');
    const submitted = await Effect.runPromise(
      payments.updateDisputeEvidence({
        reference,
        text: { uncategorized_text: 'final' },
        files: { service_documentation: 'mock_file_1' },
        submit: true
      })
    );
    expect(submitted).toMatchObject({ status: 'under_review', submissionCount: 1 });
    const again = await Effect.runPromise(
      payments
        .updateDisputeEvidence({ reference, text: {}, files: {}, submit: true })
        .pipe(Effect.flip)
    );
    expect(again.refusal).toContain('under_review');
    expect(payments.disputeEvidence(reference)).toHaveLength(2);
  });

  it('a won dispute gives the amount back (not the fee); a lost one keeps it', async () => {
    const { payments, payment } = await charged();
    const won = payments.openDispute(payment.reference);
    expect(payments.closeDispute(won.reference, 'won').balanceTransactions).toEqual([
      expect.objectContaining({ kind: 'withdrawal', amountCents: 13206, feeCents: 1500 }),
      expect.objectContaining({ kind: 'reinstatement', amountCents: 13206, feeCents: 0 })
    ]);
    const lost = payments.openDispute(payment.reference, { amountCents: 5000 });
    const closed = payments.closeDispute(lost.reference, 'lost');
    expect(closed).toMatchObject({ status: 'lost', chargeRefundable: false });
    expect(closed.balanceTransactions).toHaveLength(1);
  });

  it('uploads evidence files', async () => {
    const payments = makeMockPayments();
    const file = await Effect.runPromise(
      payments.uploadDisputeFile({ name: 'evidence.pdf', bytes: new Uint8Array(10) })
    );
    expect(file.reference).toBe('mock_file_1');
    expect(payments.disputeFiles()).toEqual([
      { reference: 'mock_file_1', name: 'evidence.pdf', bytes: 10 }
    ]);
  });
});
