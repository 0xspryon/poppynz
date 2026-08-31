import {
  canApplyCredibledTransition,
  credibledStatusToSafetyVerificationStatus
} from '@repo/credibled';
import type { SafetyVerification } from '@repo/db';
import { describe, expect, it } from 'vitest';
import {
  addMonths,
  expiryFromCompletion,
  isVerified,
  presentedStatus,
  toApplicantSummary,
  toDateOnly,
  toPublicBadge
} from './safety-verification';

const record = (overrides: Partial<SafetyVerification> = {}): SafetyVerification =>
  ({
    id: 'sv-1',
    userId: 'user-1',
    role: 'service-provider',
    status: 'verified',
    route: 'credibled',
    credibledCheckUuid: 'check-1',
    credibledCheckTypeValue: 'request_enhanced_criminal_record_check',
    consentAt: new Date('2026-08-01T00:00:00.000Z'),
    consentPolicyVersion: '2026-08-22',
    paymentReference: 'mock_auth_sv-1',
    refundReference: null,
    amountCents: 4500,
    feeCents: 500,
    taxCents: 0,
    totalCents: 5000,
    issuingAuthority: null,
    documentNumber: null,
    filename: null,
    fileKey: null,
    issuedOn: '2026-08-01',
    expiresOn: '2027-08-01',
    reviewedBy: 'admin-1',
    reviewedAt: new Date('2026-08-02T00:00:00.000Z'),
    decisionReason: null,
    expiryNotifiedAt: null,
    orderAttempts: 1,
    lastOrderError: null,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    ...overrides
  }) as SafetyVerification;

describe('expiry arithmetic', () => {
  it('clamps a month-end rollover instead of spilling into the next month', () => {
    // Jan 31 + 1 month must be Feb 28, not Mar 3.
    expect(toDateOnly(addMonths(new Date('2026-01-31T00:00:00.000Z'), 1))).toBe('2026-02-28');
    expect(toDateOnly(addMonths(new Date('2028-01-31T00:00:00.000Z'), 1))).toBe('2028-02-29');
  });

  it('measures validity from completion', () => {
    expect(expiryFromCompletion(new Date('2026-08-22T13:00:00.000Z'), 12)).toBe('2027-08-22');
  });
});

describe('read-time expiry', () => {
  it('presents a lapsed verified record as expired without waiting for the sweep', () => {
    const lapsed = record({ status: 'verified', expiresOn: '2026-08-21' });
    expect(presentedStatus(lapsed, '2026-08-22')).toBe('expired');
    expect(isVerified(lapsed, '2026-08-22')).toBe(false);
  });

  it('keeps a record valid on its expiry date itself', () => {
    const today = record({ status: 'verified', expiresOn: '2026-08-22' });
    expect(presentedStatus(today, '2026-08-22')).toBe('verified');
    expect(isVerified(today, '2026-08-22')).toBe(true);
  });

  it('treats a missing record as unverified', () => {
    expect(isVerified(null, '2026-08-22')).toBe(false);
  });

  it('never treats a review_required record as verified', () => {
    // The whole point of the upload route: submitted is not verified.
    const submitted = record({ status: 'review_required', route: 'uploaded_document' });
    expect(isVerified(submitted, '2026-08-22')).toBe(false);
  });
});

describe('what each audience can see', () => {
  it('gives other users only a boolean and a date', () => {
    const badge = toPublicBadge(record(), '2026-08-22');
    expect(badge).toEqual({ verified: true, verifiedUntil: '2027-08-01' });
    expect(Object.keys(badge)).toEqual(['verified', 'verifiedUntil']);
  });

  it('hides the expiry date once a record has lapsed', () => {
    expect(toPublicBadge(record({ expiresOn: '2026-08-01' }), '2026-08-22')).toEqual({
      verified: false,
      verifiedUntil: null
    });
  });

  it('never leaks screening detail to the applicant', () => {
    const summary = toApplicantSummary(record({ documentNumber: 'VSC-99', fileKey: 'k' }), '2026-08-22');
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain('VSC-99');
    expect(serialised).not.toContain('check-1');
    expect(serialised).not.toContain('admin-1');
  });

  it('does show a rejection reason, which the applicant is entitled to', () => {
    const summary = toApplicantSummary(
      record({ status: 'rejected', decisionReason: 'Document was illegible.' }),
      '2026-08-22'
    );
    expect(summary.status).toBe('rejected');
    expect(summary.decisionReason).toBe('Document was illegible.');
  });

  it('reports not_started when there is no record at all', () => {
    expect(toApplicantSummary(null, '2026-08-22').status).toBe('not_started');
  });
});

describe('credibled status mapping', () => {
  it('never auto-verifies, even on a pass', () => {
    expect(credibledStatusToSafetyVerificationStatus('Complete')).toBe('review_required');
  });

  it('routes anything needing attention to review', () => {
    expect(credibledStatusToSafetyVerificationStatus('Action Required')).toBe('review_required');
    expect(credibledStatusToSafetyVerificationStatus('In Dispute')).toBe('review_required');
  });

  it('fails closed on an unrecognised status', () => {
    expect(credibledStatusToSafetyVerificationStatus('Something New')).toBe('review_required');
  });

  it('maps the ordinary progression', () => {
    expect(credibledStatusToSafetyVerificationStatus('Waiting On Candidate')).toBe('invited');
    expect(credibledStatusToSafetyVerificationStatus('In Progress')).toBe('in_progress');
    expect(credibledStatusToSafetyVerificationStatus('Cancelled')).toBe('rejected');
  });
});

describe('webhook replay and ordering defence', () => {
  it('applies a forward transition', () => {
    expect(canApplyCredibledTransition('invited', 'in_progress')).toBe(true);
    expect(canApplyCredibledTransition('in_progress', 'review_required')).toBe(true);
  });

  it('ignores a duplicate delivery', () => {
    expect(canApplyCredibledTransition('in_progress', 'in_progress')).toBe(false);
  });

  it('ignores an out-of-order delivery that would drag the record backwards', () => {
    // Credibled sends no timestamp, so this rank check IS the replay defence.
    expect(canApplyCredibledTransition('review_required', 'in_progress')).toBe(false);
    expect(canApplyCredibledTransition('review_required', 'invited')).toBe(false);
  });

  it('refuses to reopen a decided record', () => {
    // A replayed "Complete" must never undo an admin's rejection, and no
    // vendor event may move a verified record at all.
    expect(canApplyCredibledTransition('rejected', 'review_required')).toBe(false);
    expect(canApplyCredibledTransition('verified', 'review_required')).toBe(false);
    expect(canApplyCredibledTransition('expired', 'in_progress')).toBe(false);
  });
});
