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
    expect(
      Exit.isFailure(await Effect.runPromiseExit(down.findPaymentByRowId('payment-1')))
    ).toBe(true);
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
