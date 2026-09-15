import {
  canApplyCredibledTransition,
  credibledStatusToCheckOrderStatus
} from '@repo/credibled';
import type { CheckOrder, Payment, SafetyVerification } from '@repo/db';
import { describe, expect, it } from 'vitest';
import {
  addMonths,
  expiryFromCompletion,
  isVerified,
  orderPresentedStatus,
  presentedStatus,
  toAdminSummary,
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
    checkOrderId: 'order-1',
    consentAt: new Date('2026-08-01T00:00:00.000Z'),
    consentPolicyVersion: '2026-08-22',
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
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    ...overrides
  }) as SafetyVerification;

const order = (overrides: Partial<CheckOrder> = {}): CheckOrder =>
  ({
    id: 'order-1',
    userId: 'user-1',
    role: 'service-provider',
    status: 'complete',
    paymentId: 'payment-1',
    credibledCheckUuid: 'check-1',
    applicationUrl: 'https://credibled.example/apply/check-1',
    consentAt: new Date('2026-08-01T00:00:00.000Z'),
    consentPolicyVersion: '2026-08-22',
    orderAttempts: 1,
    lastOrderError: null,
    completedAt: new Date('2026-08-01T12:00:00.000Z'),
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    ...overrides
  }) as CheckOrder;

const payment = (overrides: Partial<Payment> = {}): Payment =>
  ({
    id: 'payment-1',
    userId: 'user-1',
    kind: 'credibled_order',
    status: 'authorised',
    provider: 'mock',
    providerReference: 'mock_auth_payment-1',
    refundReference: null,
    amountCents: 4500,
    feeCents: 500,
    taxCents: 0,
    totalCents: 5000,
    currency: 'CAD',
    lastError: null,
    authorisedAt: new Date('2026-08-01T00:00:00.000Z'),
    capturedAt: null,
    refundedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as Payment;

const summary = (
  state: Partial<{
    verification: SafetyVerification | null;
    order: CheckOrder | null;
    payment: Payment | null;
  }> = {}
) =>
  toApplicantSummary(
    { verification: null, order: null, payment: null, ...state },
    '2026-08-22'
  );

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

describe('what the applicant sees before there is a verdict', () => {
  it('reads an order in flight in the applicant vocabulary', () => {
    expect(orderPresentedStatus(order({ status: 'draft' }))).toBe('not_started');
    expect(orderPresentedStatus(order({ status: 'payment_pending' }))).toBe('payment_pending');
    expect(orderPresentedStatus(order({ status: 'paid' }))).toBe('payment_pending');
    expect(orderPresentedStatus(order({ status: 'invited' }))).toBe('invited');
    expect(orderPresentedStatus(order({ status: 'in_progress' }))).toBe('in_progress');
  });

  it('presents a finished order as nothing — its outcome is the verdict, if any', () => {
    // A failed or cancelled order occupies no live slot, exactly as a rejected
    // verdict never has, so the applicant sees a clean slate.
    expect(orderPresentedStatus(order({ status: 'complete' }))).toBeNull();
    expect(orderPresentedStatus(order({ status: 'failed' }))).toBeNull();
    expect(orderPresentedStatus(order({ status: 'cancelled' }))).toBeNull();
    expect(summary({ order: order({ status: 'failed' }) }).status).toBe('not_started');
  });

  it('surfaces the Credibled link only while the applicant has something to do', () => {
    expect(summary({ order: order({ status: 'invited' }) }).applicationUrl).toBe(
      'https://credibled.example/apply/check-1'
    );
    expect(summary({ order: order({ status: 'in_progress' }) }).applicationUrl).toBe(
      'https://credibled.example/apply/check-1'
    );
    expect(summary({ order: order({ status: 'paid' }) }).applicationUrl).toBeNull();
    expect(
      summary({ verification: record({ status: 'review_required' }), order: order() })
        .applicationUrl
    ).toBeNull();
  });

  it('lets the verdict win once there is one', () => {
    const state = summary({
      verification: record({ status: 'review_required' }),
      order: order(),
      payment: payment()
    });
    expect(state.status).toBe('review_required');
    expect(state.route).toBe('credibled');
    // What was charged still shows — frozen at authorisation.
    expect(state.cost?.totalCents).toBe(5000);
  });

  it('shows a cost only for money actually taken', () => {
    expect(summary({ order: order(), payment: payment({ status: 'pending' }) }).cost).toBeNull();
    expect(summary({ order: order(), payment: payment({ status: 'failed' }) }).cost).toBeNull();
    expect(summary({ order: order(), payment: payment({ status: 'authorised' }) }).cost).toEqual({
      amountCents: 4500,
      feeCents: 500,
      taxCents: 0,
      totalCents: 5000,
      currency: 'CAD'
    });
    // A refund is still money that was taken; the applicant should see it.
    expect(
      summary({ order: order(), payment: payment({ status: 'refunded' }) }).cost?.totalCents
    ).toBe(5000);
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
    const serialised = JSON.stringify(
      summary({
        verification: record({ documentNumber: 'VSC-99', fileKey: 'k' }),
        order: order({ credibledCheckUuid: 'check-1' }),
        payment: payment({ providerReference: 'pi_secret' })
      })
    );
    expect(serialised).not.toContain('VSC-99');
    expect(serialised).not.toContain('check-1');
    expect(serialised).not.toContain('pi_secret');
    expect(serialised).not.toContain('admin-1');
  });

  it('does show a rejection reason, which the applicant is entitled to', () => {
    const state = summary({
      verification: record({ status: 'rejected', decisionReason: 'Document was illegible.' })
    });
    expect(state.status).toBe('rejected');
    expect(state.decisionReason).toBe('Document was illegible.');
  });

  it('reports not_started when there is nothing at all', () => {
    expect(summary().status).toBe('not_started');
  });

  it('tells an administrator there is a report exactly when an order is linked', () => {
    expect(toAdminSummary(record(), '2026-08-22').hasCredibledCheck).toBe(true);
    expect(
      toAdminSummary(record({ route: 'uploaded_document', checkOrderId: null }), '2026-08-22')
        .hasCredibledCheck
    ).toBe(false);
  });

  it('keeps money off the review screen', () => {
    // What an applicant paid has no bearing on whether they are safe.
    const keys = Object.keys(toAdminSummary(record(), '2026-08-22'));
    expect(keys.some((key) => /payment|refund|cents/i.test(key))).toBe(false);
  });
});

describe('credibled status mapping', () => {
  it('never auto-verifies, even on a pass — it completes the order', () => {
    expect(credibledStatusToCheckOrderStatus('Complete')).toBe('complete');
  });

  it('routes anything needing attention to completion, where a person looks', () => {
    expect(credibledStatusToCheckOrderStatus('Action Required')).toBe('complete');
    expect(credibledStatusToCheckOrderStatus('In Dispute')).toBe('complete');
  });

  it('fails closed on an unrecognised status', () => {
    expect(credibledStatusToCheckOrderStatus('Something New')).toBe('complete');
  });

  it('maps the ordinary progression', () => {
    expect(credibledStatusToCheckOrderStatus('Waiting On Candidate')).toBe('invited');
    expect(credibledStatusToCheckOrderStatus('In Progress')).toBe('in_progress');
    expect(credibledStatusToCheckOrderStatus('Cancelled')).toBe('cancelled');
  });
});

describe('webhook replay and ordering defence', () => {
  it('applies a forward transition', () => {
    expect(canApplyCredibledTransition('invited', 'in_progress')).toBe(true);
    expect(canApplyCredibledTransition('in_progress', 'complete')).toBe(true);
  });

  it('ignores a duplicate delivery', () => {
    expect(canApplyCredibledTransition('in_progress', 'in_progress')).toBe(false);
  });

  it('ignores an out-of-order delivery that would drag the order backwards', () => {
    // Credibled sends no timestamp, so this rank check IS the replay defence.
    expect(canApplyCredibledTransition('complete', 'in_progress')).toBe(false);
    expect(canApplyCredibledTransition('in_progress', 'invited')).toBe(false);
  });

  it('refuses to reopen a finished order', () => {
    // A replayed "Complete" must never resurrect a failed or cancelled order,
    // and no vendor event may move a completed one at all.
    expect(canApplyCredibledTransition('failed', 'complete')).toBe(false);
    expect(canApplyCredibledTransition('cancelled', 'complete')).toBe(false);
    expect(canApplyCredibledTransition('complete', 'complete')).toBe(false);
  });

  it('refuses to advance an order the vendor does not hold yet', () => {
    // Placement is the worker's job; a delivery can't skip it.
    expect(canApplyCredibledTransition('paid', 'invited')).toBe(false);
    expect(canApplyCredibledTransition('draft', 'complete')).toBe(false);
  });
});
