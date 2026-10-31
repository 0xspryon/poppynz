import { describe, expect, it } from 'bun:test';
import { isPayoutAccountReference, uatAddress, uatFixtureUsers } from './fixtures';
import { uatFixtureSettings } from './run';

describe('UAT account addresses', () => {
  it('keeps the historical @example.test addresses and ids without a base', () => {
    const users = uatFixtureUsers(null);
    expect([users.family, users.helper].map((user) => [user.id, user.email])).toEqual([
      ['dev-billing-family', 'billing-family@example.test'],
      ['dev-billing-helper', 'billing-helper@example.test']
    ]);
    expect(users.replacements.map((extra) => extra.user.email)).toEqual([
      'replacement-helper@example.test',
      'replacement-tutor@example.test',
      'replacement-pending@example.test'
    ]);
    expect(users.accountant.email).toBe('accountant@example.test');
  });

  it('derives plus-addresses, and ids from them, from UAT_EMAIL_BASE', () => {
    const users = uatFixtureUsers('kay@poppynz.com');
    expect(
      [users.family, users.helper, ...users.replacements.map((extra) => extra.user)].map(
        (user) => user.email
      )
    ).toEqual([
      'kay+fiona@poppynz.com',
      'kay+hana@poppynz.com',
      'kay+robin@poppynz.com',
      'kay+theo@poppynz.com',
      'kay+paula@poppynz.com'
    ]);
    expect(users.accountant.email).toBe('kay+accountant@poppynz.com');
    // A new base never reuses a previous base's primary key.
    expect(users.family.id).toBe('uat-kay+fiona@poppynz.com');
    expect(uatAddress('fiona', 'sam@poppynz.com').id).not.toBe(users.family.id);
  });

  it('refuses a base that is not an address', () => {
    expect(() => uatFixtureUsers('poppynz.com')).toThrow('UAT_EMAIL_BASE');
  });

  it('keeps the dev fixture people: Fiona in Toronto, Hana in Winnipeg', () => {
    const users = uatFixtureUsers(null);
    expect([users.family.profile.city, users.family.profile.stateProvince]).toEqual([
      'Toronto',
      'ON'
    ]);
    expect([users.helper.profile.city, users.helper.profile.stateProvince]).toEqual([
      'Winnipeg',
      'MB'
    ]);
  });
});

describe('the staging UAT step', () => {
  it('runs only for an explicit staging or dev ENVIRONMENT with UAT_FIXTURES=enabled', () => {
    expect(uatFixtureSettings({ ENVIRONMENT: 'staging', UAT_FIXTURES: 'enabled' })).toEqual({
      run: true,
      emailBase: null,
      payoutAccountReference: null
    });
    expect(
      uatFixtureSettings({
        ENVIRONMENT: 'staging',
        UAT_FIXTURES: 'enabled',
        UAT_EMAIL_BASE: ' kay@poppynz.com ',
        UAT_HELPER_PAYOUT_ACCOUNT: 'acct_123'
      })
    ).toEqual({ run: true, emailBase: 'kay@poppynz.com', payoutAccountReference: 'acct_123' });
    expect(uatFixtureSettings({ ENVIRONMENT: 'production', UAT_FIXTURES: 'enabled' }).run).toBe(
      false
    );
    expect(uatFixtureSettings({ UAT_FIXTURES: 'enabled' }).run).toBe(false);
    expect(uatFixtureSettings({ ENVIRONMENT: 'staging' }).run).toBe(false);
  });

  it('refuses a payout account that is not a Stripe account id', () => {
    expect(
      uatFixtureSettings({
        ENVIRONMENT: 'staging',
        UAT_FIXTURES: 'enabled',
        UAT_HELPER_PAYOUT_ACCOUNT: 'cus_123'
      })
    ).toEqual({
      run: false,
      reason: 'UAT_HELPER_PAYOUT_ACCOUNT must be a Stripe account id (acct_…)'
    });
    expect(isPayoutAccountReference('acct_1AbC')).toBe(true);
    expect(isPayoutAccountReference('')).toBe(false);
  });
});
