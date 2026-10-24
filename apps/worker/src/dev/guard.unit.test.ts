import { describe, expect, it } from 'vitest';
import { checkDevClock } from './guard';

describe('checkDevClock', () => {
  it('runs only with ENVIRONMENT=dev set explicitly and BILLING_DEV_CLOCK=enabled', () => {
    expect(checkDevClock({ ENVIRONMENT: 'dev', BILLING_DEV_CLOCK: 'enabled' })).toEqual({
      ok: true
    });
  });

  it('refuses when ENVIRONMENT is unset, even though it defaults to dev elsewhere', () => {
    expect(checkDevClock({ BILLING_DEV_CLOCK: 'enabled' }).ok).toBe(false);
  });

  it('refuses without the explicit opt-in', () => {
    expect(checkDevClock({ ENVIRONMENT: 'dev' }).ok).toBe(false);
    expect(checkDevClock({ ENVIRONMENT: 'dev', BILLING_DEV_CLOCK: 'true' }).ok).toBe(false);
  });

  it('always refuses production and staging', () => {
    expect(checkDevClock({ ENVIRONMENT: 'production', BILLING_DEV_CLOCK: 'enabled' })).toEqual({
      ok: false,
      reason: 'refusing to run in production'
    });
    expect(
      checkDevClock({ ENVIRONMENT: 'dev', NODE_ENV: 'production', BILLING_DEV_CLOCK: 'enabled' }).ok
    ).toBe(false);
    expect(checkDevClock({ ENVIRONMENT: 'staging', BILLING_DEV_CLOCK: 'enabled' }).ok).toBe(false);
  });
});
