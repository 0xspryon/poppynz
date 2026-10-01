import { dummyVouch, type VouchWithVoucher } from '@repo/db';
import { describe, expect, it } from 'vitest';
import {
  applicantVouchStatus,
  canVouch,
  presentedVouchStatus,
  summariseVouches,
  vouchCounts
} from './vouches';

const NOW = new Date('2026-10-01T12:00:00.000Z');

const standing = { banned: false, banExpires: null, emailVerified: true, hasLiveApproval: true };

const entry = (
  overrides: Partial<VouchWithVoucher> = {},
  voucher: Partial<VouchWithVoucher['voucher']> = {}
): VouchWithVoucher => ({
  ...dummyVouch,
  status: 'accepted',
  answers: {
    howKnow: 'Neighbour',
    howLong: '3 years',
    wouldTrust: 'yes',
    hasConcerns: false,
    concernsDetail: null,
    wouldHire: 'yes',
    anythingElse: null
  },
  ...overrides,
  voucher: { name: 'V', email: 'v@x.dev', firstName: null, lastName: null, ...standing, ...voucher }
});

describe('presentedVouchStatus', () => {
  it('presents a pending vouch past its expiry as expired', () => {
    expect(
      presentedVouchStatus({ status: 'pending', expiresAt: new Date('2026-09-30T00:00:00Z') }, NOW)
    ).toBe('expired');
  });
  it('keeps an accepted vouch accepted after the request window', () => {
    expect(
      presentedVouchStatus({ status: 'accepted', expiresAt: new Date('2026-09-30T00:00:00Z') }, NOW)
    ).toBe('accepted');
  });
});

describe('canVouch', () => {
  it('requires a live approval, a verified email and no active ban', () => {
    expect(canVouch(standing, NOW)).toBe(true);
    expect(canVouch({ ...standing, hasLiveApproval: false }, NOW)).toBe(false);
    expect(canVouch({ ...standing, emailVerified: false }, NOW)).toBe(false);
    expect(canVouch({ ...standing, banned: true }, NOW)).toBe(false);
  });
  it('treats a ban that has run out as no ban', () => {
    expect(
      canVouch({ ...standing, banned: true, banExpires: new Date('2026-09-01T00:00:00Z') }, NOW)
    ).toBe(true);
  });
});

describe('vouchCounts / summariseVouches', () => {
  it('counts only accepted vouches from vouchers in good standing', () => {
    expect(vouchCounts(entry(), NOW)).toBe(true);
    expect(vouchCounts(entry({ status: 'flagged' }), NOW)).toBe(false);
    expect(vouchCounts(entry({}, { hasLiveApproval: false }), NOW)).toBe(false);
  });
  it('counts distinct vouchers, so one person never fills two slots', () => {
    const summary = summariseVouches(
      [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c', voucherUserId: 'voucher-2' })],
      NOW
    );
    expect(summary.counting).toBe(2);
  });
  it('raises a concern for a flagged vouch or an accepted one that answered yes to concerns', () => {
    expect(summariseVouches([entry({ status: 'flagged' })], NOW).hasConcern).toBe(true);
    expect(
      summariseVouches(
        [entry({ answers: { ...entry().answers!, hasConcerns: true, concernsDetail: 'Late' } })],
        NOW
      ).hasConcern
    ).toBe(true);
    expect(summariseVouches([entry()], NOW).hasConcern).toBe(false);
  });
});

describe('applicantVouchStatus', () => {
  it('never tells the applicant why a vouch stopped counting', () => {
    expect(applicantVouchStatus(entry({ status: 'flagged' }), NOW)).toBe('not_counted');
    expect(applicantVouchStatus(entry({ status: 'revoked' }), NOW)).toBe('not_counted');
    expect(applicantVouchStatus(entry({}, { banned: true }), NOW)).toBe('not_counted');
    expect(applicantVouchStatus(entry(), NOW)).toBe('completed');
    expect(applicantVouchStatus(entry({ status: 'declined' }), NOW)).toBe('declined');
  });
});
