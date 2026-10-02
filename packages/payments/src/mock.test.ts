import { describe, expect, it } from 'bun:test';
import { Effect, Exit } from 'effect';
import { makeMockPayments } from './mock';
import { quoteFromPolicy } from './port';

const quote = quoteFromPolicy([{ label: 'Check', costCents: 4500 }], {
  adminFeeCents: 500,
  taxRateBasisPoints: 0
});

describe('quoteFromPolicy', () => {
  it('adds the fee and tax to the lines, in integer cents', () => {
    const taxed = quoteFromPolicy([{ label: 'Check', costCents: 4500 }], {
      adminFeeCents: 500,
      taxRateBasisPoints: 1300
    });
    expect(taxed).toMatchObject({
      amountCents: 4500,
      feeCents: 500,
      taxCents: 650,
      totalCents: 5650
    });
  });

  it('charges nothing at all for an empty basket', () => {
    expect(quoteFromPolicy([], { adminFeeCents: 500, taxRateBasisPoints: 1300 }).totalCents).toBe(
      0
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
