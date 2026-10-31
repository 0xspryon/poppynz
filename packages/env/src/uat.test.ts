import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Either } from 'effect';
import { billingTimeTravelConfig, checkBillingTimeTravel, checkUatFixtures, uatEmail } from './index';

const read = <A>(config: Effect.Effect<A, unknown>, env: Record<string, string>) =>
  Effect.runSync(
    Effect.either(
      config.pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(env)))))
    )
  );

describe('the UAT accounts switch', () => {
  it('needs an explicit staging or dev ENVIRONMENT and UAT_FIXTURES=enabled', () => {
    expect(checkUatFixtures({ ENVIRONMENT: 'staging', UAT_FIXTURES: 'enabled' }).enabled).toBe(
      true
    );
    expect(checkUatFixtures({ ENVIRONMENT: 'dev', UAT_FIXTURES: 'enabled' }).enabled).toBe(true);
    // A production image (NODE_ENV=production) is how staging runs.
    expect(
      checkUatFixtures({ ENVIRONMENT: ' Staging ', UAT_FIXTURES: 'ENABLED', NODE_ENV: 'production' })
        .enabled
    ).toBe(true);
  });

  it('never runs for production, an unset ENVIRONMENT or without the switch', () => {
    expect(checkUatFixtures({ ENVIRONMENT: 'production', UAT_FIXTURES: 'enabled' })).toEqual({
      enabled: false,
      reason: 'ENVIRONMENT is production'
    });
    expect(checkUatFixtures({ UAT_FIXTURES: 'enabled' }).enabled).toBe(false);
    expect(checkUatFixtures({ ENVIRONMENT: '', UAT_FIXTURES: 'enabled' }).enabled).toBe(false);
    expect(checkUatFixtures({ ENVIRONMENT: 'qa', UAT_FIXTURES: 'enabled' }).enabled).toBe(false);
    expect(checkUatFixtures({ ENVIRONMENT: 'staging' }).enabled).toBe(false);
    expect(checkUatFixtures({ ENVIRONMENT: 'staging', UAT_FIXTURES: 'true' }).enabled).toBe(false);
  });
});

describe('the billing fast-forward switch', () => {
  const on = { ENVIRONMENT: 'staging', BILLING_TIME_TRAVEL: 'enabled' };

  it('is on for staging and dev with BILLING_TIME_TRAVEL=enabled and the mock provider', () => {
    expect(checkBillingTimeTravel(on).enabled).toBe(true);
    expect(checkBillingTimeTravel({ ...on, ENVIRONMENT: 'dev' }).enabled).toBe(true);
    expect(checkBillingTimeTravel({ ...on, PAYMENTS_PROVIDER: 'mock' }).enabled).toBe(true);
  });

  it('needs a Stripe TEST key when Stripe is the provider', () => {
    expect(
      checkBillingTimeTravel({ ...on, PAYMENTS_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_1' })
        .enabled
    ).toBe(true);
    expect(
      checkBillingTimeTravel({ ...on, PAYMENTS_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_live_1' })
    ).toEqual({ enabled: false, reason: 'STRIPE_SECRET_KEY is not a test key (sk_test_…)' });
    expect(
      checkBillingTimeTravel({ ...on, PAYMENTS_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'rk_live_1' })
        .enabled
    ).toBe(false);
    expect(checkBillingTimeTravel({ ...on, PAYMENTS_PROVIDER: 'stripe' }).enabled).toBe(false);
  });

  it('is off for production, an unset ENVIRONMENT or without the switch', () => {
    expect(checkBillingTimeTravel({ ...on, ENVIRONMENT: 'production' }).enabled).toBe(false);
    expect(checkBillingTimeTravel({ BILLING_TIME_TRAVEL: 'enabled' }).enabled).toBe(false);
    expect(checkBillingTimeTravel({ ENVIRONMENT: 'staging' }).enabled).toBe(false);
    expect(checkBillingTimeTravel({ ...on, BILLING_TIME_TRAVEL: 'disabled' }).enabled).toBe(false);
  });

  it('allows 60 days ahead unless BILLING_TIME_TRAVEL_MAX_DAYS says otherwise', () => {
    expect(read(billingTimeTravelConfig, {})).toEqual(Either.right({ maxDays: 60 }));
    expect(read(billingTimeTravelConfig, { BILLING_TIME_TRAVEL_MAX_DAYS: '14' })).toEqual(
      Either.right({ maxDays: 14 })
    );
    expect(Either.isLeft(read(billingTimeTravelConfig, { BILLING_TIME_TRAVEL_MAX_DAYS: '0' }))).toBe(
      true
    );
    expect(
      Either.isLeft(read(billingTimeTravelConfig, { BILLING_TIME_TRAVEL_MAX_DAYS: 'lots' }))
    ).toBe(true);
  });
});

describe('UAT addresses', () => {
  it('derives plus-addresses from UAT_EMAIL_BASE', () => {
    expect(uatEmail('kay@poppynz.com', 'fiona')).toBe('kay+fiona@poppynz.com');
    expect(uatEmail(' Kay@PoppyNZ.com ', 'hana')).toBe('kay+hana@poppynz.com');
    expect(uatEmail('kay+old@poppynz.com', 'theo')).toBe('kay+theo@poppynz.com');
    expect(uatEmail('not-an-address', 'fiona')).toBeNull();
    expect(uatEmail('a@b', 'fiona')).toBeNull();
  });
});
