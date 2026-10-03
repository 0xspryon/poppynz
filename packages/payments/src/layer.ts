import { stripeConfig } from '@repo/env';
import { ConfigError, Effect, Layer, Option, Redacted } from 'effect';
import { makeMockPayments } from './mock';
import { Payments } from './port';
import { makeStripeClient, makeStripePayments } from './stripe';

const secretValue = (value: Option.Option<Redacted.Redacted<string>>) =>
  Option.match(value, {
    onNone: () => null,
    onSome: (secret) => {
      const raw = Redacted.value(secret).trim();
      return raw.length > 0 ? raw : null;
    }
  });

/**
 * The `Payments` layer both the API and the worker build, chosen by
 * PAYMENTS_PROVIDER (default `mock`). With `stripe`, a missing or live secret
 * key fails the layer — and so the process — at boot: this piece is test mode
 * only, and a misconfigured deploy must not limp along on the mock.
 */
export const PaymentsLive = Layer.effect(
  Payments,
  Effect.gen(function* () {
    const config = yield* stripeConfig;
    if (config.provider === 'mock') {
      return makeMockPayments();
    }
    const secretKey = secretValue(config.secretKey);
    if (secretKey === null) {
      return yield* Effect.fail(
        ConfigError.MissingData(
          ['STRIPE_SECRET_KEY'],
          'PAYMENTS_PROVIDER=stripe needs STRIPE_SECRET_KEY'
        )
      );
    }
    if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('rk_test_')) {
      return yield* Effect.fail(
        ConfigError.InvalidData(['STRIPE_SECRET_KEY'], 'Only Stripe test-mode keys are accepted')
      );
    }
    const webhookSecret = secretValue(config.webhookSecret);
    if (webhookSecret === null) {
      console.warn(
        '[payments] STRIPE_WEBHOOK_SECRET is not set — every Stripe webhook will be refused'
      );
    }
    return makeStripePayments({
      client: makeStripeClient(secretKey),
      webhookSecret,
      connectWebhookSecret: secretValue(config.connectWebhookSecret)
    });
  })
);
