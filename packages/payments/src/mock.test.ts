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
