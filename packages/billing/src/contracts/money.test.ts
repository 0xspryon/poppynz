import { describe, expect, it } from 'bun:test';
import { dummySessionResolution, type SessionResolution } from '@repo/db';
import { PaymentProviderError } from '@repo/payments';
import { Effect } from 'effect';
import {
  reconcileSession,
  recordManualPayout,
  decideManualPayout,
  previewSessionMoney,
  runSessionMoneyTick,
  settleSessionRefundByReference
} from './money';
import {
  at,
  CYCLE_1,
  FAMILY_TOTAL,
  makeWorld,
  readyAccount,
  type WorldOptions
} from './test-world';

/**
 * Tier 3 step 2 (spec §7, §8): applying a resolution by the cycle's state,
 * idempotency, refunds at the provider and session-based transfers. The
 * world is the §5 example: Mon 2 and Wed 4 Nov, $62.50 each, ON family, MB
 * helper; cycle 1 is held Sun 1 Nov, captured Mon 07:00 EST, transferred
 * Sat 7 Nov 00:00 EST.
 */
const BEFORE = new Date('2026-10-25T12:00:00.000Z');
const AFTER_CAPTURE = at(CYCLE_1.captureAt, 1);
const TRANSFER_1 = new Date('2026-11-07T05:00:00.000Z');

const world = (options: WorldOptions = {}) => {
  const w = makeWorld(options);
  const sessionOn = (date: string) => w.sessions().find((row) => row.date === date)!;
  const resolve = (date: string, overrides: Partial<SessionResolution>) => {
    const session = sessionOn(date);
    const row = dummySessionResolution({
      id: `res-${date}-${w.resolutions.state.resolutions.length}`,
      contractId: 'contract-1',
      sessionId: session.id,
      cycleId: session.cycleId,
      ...overrides
    });
    // One active resolution per session: the new one replaces the old.
    w.resolutions.state.resolutions = [
      ...w.resolutions.state.resolutions.map((r) =>
        r.sessionId === session.id && r.status !== 'reversed'
          ? { ...r, status: 'reversed' as const }
          : r
      ),
      row
    ];
    return row;
  };
  const decide = (id: string, decision: SessionResolution['decision']) => {
    w.resolutions.state.resolutions = w.resolutions.state.resolutions.map((row) =>
      row.id === id ? { ...row, status: 'decided' as const, decision } : row
    );
  };
  const reconcile = (date: string, now: Date) => {
    w.setClock(now);
    return w.run(
      reconcileSession('contract-1', sessionOn(date).id, now).pipe(Effect.provide(w.layer))
    );
  };
  const tick = async (now: Date) => {
    await w.step(now);
    return w.run(runSessionMoneyTick(now).pipe(Effect.provide(w.layer)));
  };
  return { ...w, sessionOn, resolve, decide, reconcile, tick };
};

const lateCancel = {
  kind: 'family_cancelled_late' as const,
  status: 'confirmed' as const,
  reportedBySide: 'family' as const
};

describe('applying a resolution by the cycle’s state (spec §7)', () => {
  it('not held yet: the session is left out of the plan', async () => {
    const w = world();
    await w.step(BEFORE);
    w.resolve('2026-11-04', {
      kind: 'family_cancelled_early',
      status: 'confirmed',
      reportedBySide: 'family',
      recordedAt: BEFORE
    });
    expect(await w.reconcile('2026-11-04', BEFORE)).toBe('excluded');
    expect(w.sessionOn('2026-11-04').status).toBe('cancelled');
    await w.step(at(CYCLE_1.holdAt, 5));
    expect((await w.cycles())[0]).toMatchObject({ familyTotalCents: 6604, heldCents: 6604 });
    expect(w.money.state.refunds).toHaveLength(0);
  });

  it('held, not captured: the capture is reduced (a late one keeps its compensation)', async () => {
    const w = world();
    await w.step(BEFORE);
    await w.step(at(CYCLE_1.holdAt, 5));
    // Mon 2 Nov 06:00 EST: less than 24 h before the 15:30 session.
    const recordedAt = new Date('2026-11-02T11:00:00.000Z');
    w.resolve('2026-11-02', { ...lateCancel, recordedAt });
    expect(await w.reconcile('2026-11-02', recordedAt)).toBe('reduced_capture');
    expect(w.sessionOn('2026-11-02')).toMatchObject({
      status: 'cancelled',
      compensationCents: 1563
    });
    await w.step(AFTER_CAPTURE);
    const [cycle] = await w.cycles();
    expect(cycle).toMatchObject({ heldCents: FAMILY_TOTAL, capturedCents: 6604 + 1563 });
    expect(w.money.state.refunds).toHaveLength(0);
  });

  it('charged: a session refund on the cycle’s charge, with its frozen tax lines', async () => {
    const w = world();
    await w.step(BEFORE);
    await w.step(at(CYCLE_1.holdAt, 5));
    await w.step(AFTER_CAPTURE);
    const recordedAt = new Date('2026-11-04T08:00:00.000Z');
    w.resolve('2026-11-04', { ...lateCancel, recordedAt });
    expect(await w.reconcile('2026-11-04', recordedAt)).toBe('refund');
    const [refund] = w.money.state.refunds;
    expect(refund).toMatchObject({
      status: 'succeeded',
      careCents: 6250 - 1563,
      feeCents: 312,
      feeTaxCents: 40,
      totalCents: 5039,
      commissionCents: 937
    });
    expect(refund!.feeTaxLines[0]).toMatchObject({ label: 'HST (ON) 13%', taxCents: 40 });
    expect(refund!.commissionTaxLines[0]).toMatchObject({ label: 'GST (MB) 5%', taxCents: 47 });
    expect(w.mock.refunds()).toEqual([
      expect.objectContaining({
        amountCents: 5039,
        metadata: expect.objectContaining({ refund_id: refund!.id, session_id: refund!.sessionId })
      })
    ]);
    expect(w.sessionOn('2026-11-04').status).toBe('cancelled');
    expect(w.mailTo('family')).toContain('Refund of $50.39 issued');
    const kinds = w.billingState.ledger.map((entry) => entry.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'session_refund_care',
        'session_refund_fee',
        'session_refund_fee_tax',
        'commission_reversal',
        'commission_tax_reversal',
        'cancellation_compensation'
      ])
    );
  });

  it('charged and paid: refund plus a recovery deducted from the next transfers', async () => {
    const w = world();
    await w.tick(BEFORE);
    await w.tick(at(CYCLE_1.holdAt, 5));
    await w.tick(AFTER_CAPTURE);
    await w.tick(at(TRANSFER_1, 1));
    expect(w.money.state.transfers[0]).toMatchObject({ status: 'sent', amountCents: 10531 });
    // Decided afterwards: the helper didn't show on Wednesday.
    const row = w.resolve('2026-11-04', {
      kind: 'disputed',
      status: 'contested',
      reportedBySide: 'family'
    });
    w.decide(row.id, 'helper_no_show');
    expect(await w.reconcile('2026-11-04', at(TRANSFER_1, 60))).toBe('refund_recovery');
    expect(w.money.state.refunds[0]).toMatchObject({ totalCents: 6602, status: 'succeeded' });
    expect(w.money.state.recoveries[0]).toMatchObject({ amountCents: 5266, status: 'outstanding' });
    // Never by reversing the past transfer.
    expect(w.mock.transfers()).toHaveLength(1);
    // Cycle 3 (Mon 9 Nov, $52.65 share) pays nothing and recovers $52.65.
    await w.tick(new Date('2026-11-07T06:00:00.000Z'));
    await w.tick(new Date('2026-11-08T12:01:00.000Z'));
    await w.tick(new Date('2026-11-13T05:01:00.000Z'));
    const third = w.money.state.transfers.find(
      (t) => t.sequence === 1 && t.id !== w.money.state.transfers[0]!.id
    )!;
    expect(third).toMatchObject({
      status: 'settled',
      grossCents: 5265,
      recoveredCents: 5265,
      amountCents: 0
    });
    expect(w.money.state.recoveries[0]).toMatchObject({
      recoveredCents: 5265,
      status: 'outstanding'
    });
  });
});

describe('idempotency', () => {
  it('a double click, a worker retry and a duplicate webhook refund once', async () => {
    const w = world({ mock: { refundOutcome: () => 'pending' } });
    await w.step(BEFORE);
    await w.step(at(CYCLE_1.holdAt, 5));
    await w.step(AFTER_CAPTURE);
    const recordedAt = new Date('2026-11-04T08:00:00.000Z');
    w.resolve('2026-11-04', { ...lateCancel, recordedAt });
    await w.reconcile('2026-11-04', recordedAt);
    await w.reconcile('2026-11-04', recordedAt);
    await w.tick(at(recordedAt, 15));
    expect(w.money.state.refunds).toHaveLength(1);
    expect(w.mock.refunds()).toHaveLength(1);
    expect(w.money.state.refunds[0]!.status).toBe('pending');
    const reference = w.mock.refunds()[0]!.reference;
    w.mock.settleRefund(reference, 'succeeded');
    for (let i = 0; i < 2; i += 1) {
      await w.run(
        settleSessionRefundByReference(reference, at(recordedAt, 30)).pipe(Effect.provide(w.layer))
      );
    }
    expect(w.money.state.refunds[0]!.status).toBe('succeeded');
    const subjects = w.mailTo('family');
    expect(subjects.filter((s) => s === 'Refund of $50.39 on its way')).toHaveLength(1);
    expect(subjects.filter((s) => s === 'Refund of $50.39 issued')).toHaveLength(1);
  });

  it('a provider outage leaves the refund pending, retried under the same key', async () => {
    let down = true;
    const w = world({ mock: { moneyDown: () => down } });
    await w.step(BEFORE);
    await w.step(at(CYCLE_1.holdAt, 5));
    await w.step(AFTER_CAPTURE);
    const recordedAt = new Date('2026-11-04T08:00:00.000Z');
    w.resolve('2026-11-04', { ...lateCancel, recordedAt });
    await w.reconcile('2026-11-04', recordedAt);
    expect(w.money.state.refunds[0]).toMatchObject({ status: 'pending', attempts: 1 });
    down = false;
    await w.tick(at(recordedAt, 15));
    expect(w.money.state.refunds[0]!.status).toBe('succeeded');
    expect(w.mock.refunds()).toHaveLength(1);
  });

  it('a refund that fails goes to the admins and the family is told', async () => {
    const w = world({ mock: { refundOutcome: () => 'failed' } });
    await w.step(BEFORE);
    await w.step(at(CYCLE_1.holdAt, 5));
    await w.step(AFTER_CAPTURE);
    const recordedAt = new Date('2026-11-04T08:00:00.000Z');
    w.resolve('2026-11-04', { ...lateCancel, recordedAt });
    await w.reconcile('2026-11-04', recordedAt);
    expect(w.money.state.refunds[0]).toMatchObject({ status: 'failed' });
    expect(w.alerts.some((subject) => subject.startsWith('A session refund failed'))).toBe(true);
    expect(w.mailTo('family')).toContain("Your refund of $50.39 didn't go through");
  });

  it('a refund that succeeded and later fails at the provider moves to failed', async () => {
    // Stripe's refundFail test card: the refund is created `succeeded`, then
    // turns `failed` a minute or two later (charge.refund.updated).
    const w = world();
    await w.step(BEFORE);
    await w.step(at(CYCLE_1.holdAt, 5));
    await w.step(AFTER_CAPTURE);
    const recordedAt = new Date('2026-11-04T08:00:00.000Z');
    w.resolve('2026-11-04', { ...lateCancel, recordedAt });
    await w.reconcile('2026-11-04', recordedAt);
    expect(w.money.state.refunds[0]!.status).toBe('succeeded');
    const reference = w.mock.refunds()[0]!.reference;
    w.mock.settleRefund(reference, 'failed', 'expired_or_canceled_card');
    await w.run(
      settleSessionRefundByReference(reference, at(recordedAt, 3)).pipe(Effect.provide(w.layer))
    );
    expect(w.money.state.refunds[0]).toMatchObject({
      status: 'failed',
      failureReason: 'expired_or_canceled_card'
    });
    expect(w.alerts.some((subject) => subject.startsWith('A session refund failed'))).toBe(true);
    expect(w.mailTo('family')).toContain("Your refund of $50.39 didn't go through");
  });

  it('a refund the provider refuses goes to the failure list instead of retrying forever', async () => {
    const w = world({ mock: { refundRefusal: () => 'Charge ch_1 has been disputed.' } });
    await w.step(BEFORE);
    await w.step(at(CYCLE_1.holdAt, 5));
    await w.step(AFTER_CAPTURE);
    const recordedAt = new Date('2026-11-04T08:00:00.000Z');
    w.resolve('2026-11-04', { ...lateCancel, recordedAt });
    await w.reconcile('2026-11-04', recordedAt);
    expect(w.money.state.refunds[0]).toMatchObject({
      status: 'failed',
      failureReason: 'Charge ch_1 has been disputed.'
    });
    expect(w.alerts.some((subject) => subject.startsWith('A session refund failed'))).toBe(true);
  });

  it('a refund waits while a card dispute is open on the charge', async () => {
    const w = world();
    await w.step(BEFORE);
    await w.step(at(CYCLE_1.holdAt, 5));
    await w.step(AFTER_CAPTURE);
    const payment = [...w.payments.values()][0]!;
    w.payments.set(payment.id, { ...payment, lastError: 'card dispute opened' });
    const recordedAt = new Date('2026-11-04T08:00:00.000Z');
    w.resolve('2026-11-04', { ...lateCancel, recordedAt });
    await w.reconcile('2026-11-04', recordedAt);
    expect(w.money.state.refunds[0]).toMatchObject({ status: 'pending' });
    expect(w.money.state.refunds[0]!.failureReason).toContain('dispute');
    expect(w.mock.refunds()).toHaveLength(0);
  });

  it('a decision that returns less than was refunded is absorbed, never clawed back', async () => {
    const w = world();
    await w.step(BEFORE);
    await w.step(at(CYCLE_1.holdAt, 5));
    await w.step(AFTER_CAPTURE);
    const row = w.resolve('2026-11-04', {
      kind: 'family_cancelled_early',
      status: 'confirmed',
      reportedBySide: 'family',
      recordedAt: new Date('2026-11-02T13:00:00.000Z')
    });
    await w.reconcile('2026-11-04', new Date('2026-11-02T13:00:00.000Z'));
    expect(w.money.state.refunds[0]!.totalCents).toBe(6602);
    // The helper disputes; an admin decides it was late after all.
    w.decide(row.id, 'family_cancelled_late');
    await w.reconcile('2026-11-04', new Date('2026-11-05T13:00:00.000Z'));
    expect(w.money.state.refunds).toHaveLength(1);
    expect(
      w.billingState.ledger.find((entry) => entry.kind === 'platform_absorbed')?.amountCents
    ).toBe(6602 - 5039);
  });
});

describe('session-based transfers (spec §8)', () => {
  const charged = async (options: WorldOptions = {}) => {
    const w = world(options);
    await w.tick(BEFORE);
    await w.tick(at(CYCLE_1.holdAt, 5));
    await w.tick(AFTER_CAPTURE);
    return w;
  };

  it('pays the sum of session payables from the cycle’s charge, once', async () => {
    const w = await charged();
    // A late family cancellation: the helper gets the compensation.
    const recordedAt = new Date('2026-11-04T08:00:00.000Z');
    w.resolve('2026-11-04', { ...lateCancel, recordedAt });
    await w.tick(recordedAt);
    await w.tick(at(TRANSFER_1, -15));
    expect(w.money.state.transfers).toHaveLength(0);
    await w.tick(at(TRANSFER_1, 1));
    await w.tick(at(TRANSFER_1, 16));
    const [transfer] = w.money.state.transfers;
    expect(transfer).toMatchObject({ status: 'sent', sequence: 1, amountCents: 5265 + 1563 });
    expect(w.mock.transfers()).toEqual([
      expect.objectContaining({
        amountCents: 6828,
        destination: 'mock_acct_helper-1',
        sourceTransaction: expect.stringContaining('mock_ch_')
      })
    ]);
    expect(w.money.state.items.map((item) => [item.kind, item.amountCents])).toEqual([
      ['session', 5265],
      ['session', 1563]
    ]);
    expect(w.mailTo('helper')).toContain('$68.28 payment sent');
    expect(w.billingState.ledger.some((entry) => entry.kind === 'transfer')).toBe(true);
  });

  it('holds a disputed session back and pays it in a follow-up once decided', async () => {
    const w = await charged();
    const row = w.resolve('2026-11-04', {
      kind: 'disputed',
      status: 'contested',
      reportedBySide: 'family'
    });
    await w.tick(at(TRANSFER_1, 1));
    expect(w.money.state.transfers[0]).toMatchObject({ status: 'sent', amountCents: 5265 });
    expect(w.money.state.items.find((item) => item.kind === 'held')).toBeDefined();
    expect(w.sessionOn('2026-11-04').status).toBe('disputed');
    expect(
      w.mails.find((m) => m.subject === '$52.65 payment sent')?.paragraphs.join(' ')
    ).toContain('held back');
    w.decide(row.id, 'as_scheduled');
    await w.tick(at(TRANSFER_1, 60));
    await w.tick(at(TRANSFER_1, 75));
    expect(w.money.state.transfers.map((t) => [t.sequence, t.status, t.amountCents])).toEqual([
      [1, 'sent', 5265],
      [2, 'sent', 5266]
    ]);
    expect(w.sessionOn('2026-11-04').status).toBe('completed');
  });

  it('a helper cancellation pays $0 for the session', async () => {
    const w = await charged();
    w.resolve('2026-11-04', {
      kind: 'helper_cancelled',
      status: 'confirmed',
      reportedBySide: 'helper'
    });
    await w.tick(at(TRANSFER_1, 1));
    expect(w.money.state.transfers[0]).toMatchObject({ amountCents: 5265 });
    expect(w.money.state.refunds[0]).toMatchObject({ totalCents: 6602 });
  });

  it('pauses a restricted account (admin alert, helper notice), then the manual queue at 60 days', async () => {
    const w = await charged();
    w.payouts.rows.set('helper-1', {
      ...readyAccount(),
      status: 'restricted',
      transfersActive: false
    });
    await w.tick(at(TRANSFER_1, 1));
    await w.tick(at(TRANSFER_1, 16));
    expect(w.money.state.transfers[0]).toMatchObject({ status: 'paused', amountCents: null });
    expect(w.mailTo('helper')).toContain('Payment for your sessions is on hold');
    expect(w.alerts.filter((s) => s.startsWith('Helper transfer paused'))).toHaveLength(1);
    await w.tick(new Date('2027-01-06T06:00:00.000Z'));
    expect(w.money.state.transfers[0]).toMatchObject({
      status: 'manual_review',
      amountCents: 10531
    });
    expect(w.alerts.some((s) => s.startsWith('Manual payout needed'))).toBe(true);

    const transferId = w.money.state.transfers[0]!.id;
    const record = (actor: string, amountCents = 10531) =>
      w.run(
        recordManualPayout(
          {
            transferId,
            method: 'interac',
            reference: 'ET-123',
            amountCents,
            reason: 'account restricted'
          },
          actor,
          new Date('2027-01-07T00:00:00.000Z')
        ).pipe(Effect.either, Effect.provide(w.layer))
      );
    expect(await record('admin-1', 999)).toMatchObject({
      _tag: 'Left',
      left: { reason: 'amount_mismatch' }
    });
    const recorded = await record('admin-1');
    expect(recorded._tag).toBe('Right');
    const manualId = w.money.state.manualPayouts[0]!.id;
    const decide = (actor: string) =>
      w.run(
        decideManualPayout(
          manualId,
          'approved',
          actor,
          null,
          new Date('2027-01-07T01:00:00.000Z')
        ).pipe(Effect.either, Effect.provide(w.layer))
      );
    expect(await decide('admin-1')).toMatchObject({ _tag: 'Left', left: { reason: 'same_admin' } });
    expect((await decide('admin-2'))._tag).toBe('Right');
    expect(w.money.state.transfers[0]!.status).toBe('manual_paid');
    // Never also sent through the provider, whatever the account does next.
    w.payouts.rows.set('helper-1', readyAccount());
    await w.tick(new Date('2027-01-08T00:00:00.000Z'));
    expect(w.mock.transfers()).toHaveLength(0);
    expect(w.money.state.audit.map((row) => row.action)).toEqual(['recorded', 'approved']);
  });

  it('an unknown readiness is retried, never treated as restricted', async () => {
    const w = await charged({
      payments: {
        getPayoutAccount: () =>
          Effect.fail(new PaymentProviderError({ operation: 'getPayoutAccount', cause: 'down' }))
      }
    });
    w.payouts.rows.set('helper-1', {
      ...readyAccount(),
      refreshedAt: new Date(Date.now() - 86_400_000)
    });
    await w.tick(at(TRANSFER_1, 1));
    expect(w.money.state.transfers[0]).toMatchObject({ status: 'due' });
    expect(w.mailTo('helper')).not.toContain('Payment for your sessions is on hold');
    w.payouts.rows.set('helper-1', readyAccount());
    await w.tick(at(TRANSFER_1, 16));
    expect(w.money.state.transfers[0]).toMatchObject({ status: 'sent', amountCents: 10531 });
  });

  it('a follow-up beyond what the charge has left is sent from the balance', async () => {
    // The helper's no-show is refunded in full; an admin later decides the
    // session went ahead. The refund is absorbed, and the helper's pay for it
    // no longer fits under the charge (Stripe caps source_transaction
    // transfers at the charge minus its refunds and earlier transfers).
    const w = await charged();
    const row = w.resolve('2026-11-04', {
      kind: 'helper_no_show',
      status: 'confirmed',
      reportedBySide: 'family'
    });
    await w.tick(at(TRANSFER_1, -60));
    expect(w.money.state.refunds[0]).toMatchObject({ totalCents: 6602 });
    await w.tick(at(TRANSFER_1, 1));
    expect(w.money.state.transfers[0]).toMatchObject({ status: 'sent', amountCents: 5265 });
    w.decide(row.id, 'as_scheduled');
    await w.tick(at(TRANSFER_1, 60));
    await w.tick(at(TRANSFER_1, 75));
    expect(w.money.state.transfers.map((t) => [t.sequence, t.status, t.amountCents])).toEqual([
      [1, 'sent', 5265],
      [2, 'sent', 5266]
    ]);
    expect(w.mock.transfers().map((t) => t.sourceTransaction === null)).toEqual([false, true]);
  });

  it('a transfer waits when its source charge cannot be looked up', async () => {
    let lookupDown = true;
    const w = await charged({
      payments: (mock) => ({
        getPayment: (reference) =>
          lookupDown
            ? Effect.fail(new PaymentProviderError({ operation: 'getPayment', cause: 'down' }))
            : mock.getPayment(reference)
      })
    });
    await w.tick(at(TRANSFER_1, 1));
    expect(w.mock.transfers()).toHaveLength(0);
    expect(w.money.state.transfers[0]).toMatchObject({ status: 'sending' });
    lookupDown = false;
    await w.tick(at(TRANSFER_1, 16));
    expect(w.mock.transfers()).toEqual([
      expect.objectContaining({ sourceTransaction: expect.stringContaining('mock_ch_') })
    ]);
  });

  it('a refused transfer fails for an admin', async () => {
    const w = await charged({ mock: { transferRefusal: () => 'Insufficient funds' } });
    await w.tick(at(TRANSFER_1, 1));
    expect(w.money.state.transfers[0]).toMatchObject({
      status: 'failed',
      failureReason: 'Insufficient funds'
    });
    expect(w.alerts.some((s) => s.startsWith('A transfer to a helper was refused'))).toBe(true);
  });
});

describe('previewSessionMoney (the confirm dialog)', () => {
  it('states the money before and after the charge, from the same split', async () => {
    const w = world();
    await w.step(BEFORE);
    const preview = () =>
      w.run(
        previewSessionMoney('contract-1', w.sessionOn('2026-11-04').id, {
          kind: 'family_cancelled_late',
          status: 'confirmed',
          reportedBySide: 'family',
          recordedAt: new Date('2026-11-04T08:00:00.000Z'),
          minutesWorked: null,
          decision: null,
          decisionMinutesWorked: null
        }).pipe(Effect.provide(w.layer))
      );
    expect(await preview()).toEqual({
      outcome: 'family_late',
      charged: false,
      familyBackCents: 5039,
      familyPaysCents: 1563,
      helperReceivesCents: 1563,
      held: false
    });
    await w.step(at(CYCLE_1.holdAt, 5));
    await w.step(AFTER_CAPTURE);
    expect(await preview()).toMatchObject({
      charged: true,
      familyBackCents: 5039,
      helperReceivesCents: 1563
    });
    // A preview writes nothing.
    expect(w.money.state.refunds).toHaveLength(0);
  });
});
