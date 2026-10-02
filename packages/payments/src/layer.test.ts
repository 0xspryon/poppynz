import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Exit, Layer } from 'effect';
import { PaymentsLive } from './layer';
import { Payments } from './port';

const providerUnder = (env: Record<string, string>) =>
  Effect.runPromiseExit(
    Payments.pipe(
      Effect.map((payments) => payments.provider),
      Effect.provide(
        PaymentsLive.pipe(
          Layer.provide(
            Layer.setConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(env))))
          )
        )
      )
    )
  );

describe('PaymentsLive', () => {
  it('defaults to the mock', async () => {
    expect(await providerUnder({})).toEqual(Exit.succeed('mock'));
  });

  it('builds the Stripe adapter from a test-mode key', async () => {
    const exit = await providerUnder({
      PAYMENTS_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_123'
    });
    expect(exit).toEqual(Exit.succeed('stripe'));
  });

  it('refuses to boot Stripe without a secret key', async () => {
    expect(Exit.isFailure(await providerUnder({ PAYMENTS_PROVIDER: 'stripe' }))).toBe(true);
  });

  it('refuses a live key — this piece is test mode only', async () => {
    const exit = await providerUnder({
      PAYMENTS_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_live_123'
    });
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('refuses an unknown provider name', async () => {
    expect(Exit.isFailure(await providerUnder({ PAYMENTS_PROVIDER: 'paypal' }))).toBe(true);
  });
});
