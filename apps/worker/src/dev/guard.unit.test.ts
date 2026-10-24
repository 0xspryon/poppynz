import { describe, expect, it } from 'vitest';
import { checkDevClock, checkLocalDatabase } from './guard';

describe('checkDevClock', () => {
  it('runs only with ENVIRONMENT=dev set explicitly and BILLING_DEV_CLOCK=enabled', () => {
    expect(checkDevClock({ ENVIRONMENT: 'dev', BILLING_DEV_CLOCK: 'enabled' }, 0)).toEqual({
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

  it('refuses outside UTC, where zone-less timestamps would shift', () => {
    expect(checkDevClock({ ENVIRONMENT: 'dev', BILLING_DEV_CLOCK: 'enabled' }, -60)).toEqual({
      ok: false,
      reason: 'run with TZ=UTC, like the API and worker containers'
    });
  });
});

describe('checkLocalDatabase', () => {
  it('accepts the host and compose Postgres only', () => {
    expect(checkLocalDatabase('postgres://u:p@localhost:5432/poppynz_dev').ok).toBe(true);
    expect(checkLocalDatabase('postgres://u:p@127.0.0.1:5432/poppynz_dev').ok).toBe(true);
    expect(checkLocalDatabase('postgres://u:p@postgres:5432/poppynz_dev').ok).toBe(true);
  });

  it('refuses a remote, missing or malformed DATABASE_URL', () => {
    expect(checkLocalDatabase('postgres://u:p@db.staging.poppynz.com:5432/app').ok).toBe(false);
    expect(checkLocalDatabase(undefined).ok).toBe(false);
    expect(checkLocalDatabase('not a url').ok).toBe(false);
  });
});
