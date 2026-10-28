import { describe, expect, it } from 'bun:test';
import { dummyConversationMessage, dummySessionResolution } from '@repo/db';
import { Effect, Either } from 'effect';
import {
  allocateLostCardDispute,
  assembleEvidencePack,
  attributeDisputedAmount,
  buildEvidence,
  defaultEvidenceSummary,
  defaultHelperForfeit,
  deriveTriage,
  fitEvidenceText,
  familyReviewState,
  resumeFamilyContracts,
  runCardDisputeTick,
  saveEvidenceSummary,
  submitCardDisputeEvidence,
  suspendFamilyContracts,
  syncCardDispute
} from './card-disputes';
import { cardDisputeNoticeCopy, type CardDisputeNoticeKind } from './card-dispute-notices';
import { cardDisputeHold } from './card-dispute-holds';
import { renderTextPdf, wrapLine, layoutPages } from './evidence-pdf';
import { reconcileSession, runSessionMoneyTick } from './money';
import { at, CYCLE_1, FAMILY_TOTAL, makeWorld, type WorldOptions } from './test-world';

/**
 * Tier 3 step 4: card disputes (chargebacks). The world is the §5 example
 * (Mon 2 and Wed 4 Nov, $62.50 each; the family paid $132.06 = 66.04 +
 * 66.02; the helper's shares are 52.65 and 52.66). Cycle 1 is captured Mon
 * 07:00 EST and transferred Sat 7 Nov 00:00 EST.
 */
const BEFORE = new Date('2026-10-25T12:00:00.000Z');
const AFTER_CAPTURE = at(CYCLE_1.captureAt, 1);
const TRANSFER_1 = new Date('2026-11-07T05:00:00.000Z');
const ADMIN = 'admin-1';

const world = (options: WorldOptions = {}) => {
  const w = makeWorld(options);
  const tick = async (now: Date) => {
    await w.step(now);
    return w.run(runSessionMoneyTick(now).pipe(Effect.provide(w.layer)));
  };
  const provide = <A, E>(effect: Effect.Effect<A, E, any>) =>
    w.run(effect.pipe(Effect.provide(w.layer)) as Effect.Effect<A, E, never>);
  const either = <A, E>(effect: Effect.Effect<A, E, any>) => provide(Effect.either(effect));
  const cyclePayment = async (index = 0) => {
    const cycle = (await w.cycles())[index]!;
    return w.payments.get(cycle.paymentId!)!;
  };
  const sync = (reference: string, now: Date) => {
    w.setClock(now);
    return provide(syncCardDispute(reference, now));
  };
  const dispute = () => w.cardDisputes.state.disputes[0]!;
  const sessionOn = (date: string) => w.sessions().find((row) => row.date === date)!;
  return { ...w, tick, provide, either, cyclePayment, sync, dispute, sessionOn };
};

const charged = async (options: WorldOptions = {}) => {
  const w = world(options);
  await w.tick(BEFORE);
  await w.tick(at(CYCLE_1.holdAt, 5));
  await w.tick(AFTER_CAPTURE);
  return w;
};

/** A charged cycle 1 whose charge the family's bank disputes. */
const disputed = async (
  opened: Parameters<ReturnType<typeof world>['mock']['openDispute']>[1] = {},
  options: WorldOptions = {}
) => {
  const w = await charged(options);
  const payment = await w.cyclePayment();
  const provider = w.mock.openDispute(payment.providerReference!, opened);
  const now = at(AFTER_CAPTURE, 60);
  await w.sync(provider.reference, now);
  return { w, provider, payment, now };
};

describe('attributing a disputed amount to sessions (§5 rule)', () => {
  const sessions = [
    {
      sessionId: 'wed',
      familyTotalCents: 6602,
      startsAt: new Date('2026-11-04T20:30:00Z'),
      slot: 'a'
    },
    {
      sessionId: 'mon',
      familyTotalCents: 6604,
      startsAt: new Date('2026-11-02T20:30:00Z'),
      slot: 'a'
    }
  ];

  it('the full charge: each session its own total', () => {
    expect(attributeDisputedAmount(13206, sessions)).toEqual([
      { sessionId: 'mon', disputedCents: 6604 },
      { sessionId: 'wed', disputedCents: 6602 }
    ]);
  });

  it('a partial amount: proportional, cents exact, leftover cent to the larger remainder', () => {
    // 5000 × 6604 / 13206 = 2500.37…, 5000 × 6602 / 13206 = 2499.62… →
    // floors 2500 + 2499, the leftover cent to Wed (remainder .62 > .37).
    const shares = attributeDisputedAmount(5000, sessions);
    expect(shares).toEqual([
      { sessionId: 'mon', disputedCents: 2500 },
      { sessionId: 'wed', disputedCents: 2500 }
    ]);
    expect(shares.reduce((t, row) => t + row.disputedCents, 0)).toBe(5000);
  });

  it('a tie goes to the earlier session', () => {
    const even = [
      {
        sessionId: 'b',
        familyTotalCents: 1000,
        startsAt: new Date('2026-11-04T00:00:00Z'),
        slot: 'a'
      },
      {
        sessionId: 'a',
        familyTotalCents: 1000,
        startsAt: new Date('2026-11-02T00:00:00Z'),
        slot: 'a'
      }
    ];
    expect(attributeDisputedAmount(1001, even)).toEqual([
      { sessionId: 'a', disputedCents: 501 },
      { sessionId: 'b', disputedCents: 500 }
    ]);
  });

  it('is exact over many random amounts and never above a session’s total', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let run = 0; run < 500; run++) {
      const rows = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, index) => ({
        sessionId: `s${index}`,
        familyTotalCents: 1 + Math.floor(random() * 20_000),
        startsAt: new Date(Date.UTC(2026, 10, 2 + index)),
        slot: 'x'
      }));
      const total = rows.reduce((t, row) => t + row.familyTotalCents, 0);
      const amount = Math.floor(random() * (total + 5000));
      const shares = attributeDisputedAmount(amount, rows);
      expect(shares.reduce((t, row) => t + row.disputedCents, 0)).toBe(Math.min(amount, total));
      for (const share of shares) {
        const row = rows.find((candidate) => candidate.sessionId === share.sessionId)!;
        expect(share.disputedCents).toBeLessThanOrEqual(row.familyTotalCents);
        expect(share.disputedCents).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('dispute webhooks: one idempotent sync for every lifecycle event', () => {
  it('records the dispute once with its sessions, ledger, refund flag and one admin alert', async () => {
    const { w, provider, payment, now } = await disputed();
    expect(w.cardDisputes.state.disputes).toHaveLength(1);
    expect(w.dispute()).toMatchObject({
      providerReference: provider.reference,
      paymentId: payment.id,
      familyUserId: 'family-1',
      contractId: 'contract-1',
      scope: 'cycle',
      amountCents: FAMILY_TOTAL,
      status: 'needs_response',
      triage: 'needs_response',
      withdrawnCents: FAMILY_TOTAL,
      feeCents: 1500,
      closedAt: null
    });
    expect(
      w.cardDisputes.state.sessions.map((row) => [row.familyTotalCents, row.disputedCents])
    ).toEqual([
      [6604, 6604],
      [6602, 6602]
    ]);
    const ledger = () =>
      w.billingState.ledger
        .filter((entry) => entry.kind.startsWith('dispute_'))
        .map((entry) => [entry.kind, entry.amountCents]);
    expect(ledger()).toEqual([
      ['dispute_withdrawn', FAMILY_TOTAL],
      ['dispute_fee', 1500]
    ]);
    expect(w.payments.get(payment.id)!.lastError).toBe('card dispute opened');
    expect(w.alerts.filter((subject) => subject.startsWith('Card dispute opened'))).toHaveLength(1);
    // A duplicate delivery, or `funds_withdrawn` after `created`: nothing new.
    await w.sync(provider.reference, at(now, 1));
    await w.sync(provider.reference, at(now, 2));
    expect(w.cardDisputes.state.disputes).toHaveLength(1);
    expect(w.cardDisputes.state.sessions).toHaveLength(2);
    expect(ledger()).toHaveLength(2);
    expect(w.alerts.filter((subject) => subject.startsWith('Card dispute opened'))).toHaveLength(1);
    // The family is never emailed about their own bank dispute.
    expect(w.mailTo('family').filter((s) => /dispute|review/i.test(s))).toEqual([]);
  });

  it('an extra session charged on its own payment: the dispute maps to that session', async () => {
    const w = await charged();
    const wed = w.sessionOn('2026-11-04');
    // As step 3 freezes it: the extra session's split row names its own payment.
    const cyclePayment = await w.cyclePayment();
    const extra = {
      ...cyclePayment,
      id: '0198a3b0-0000-7000-8000-00000000e001',
      kind: 'contract_extra_session' as const,
      providerReference: 'mock_pi_extra',
      totalCents: 6602,
      capturedCents: 6602
    };
    w.payments.set(extra.id, extra);
    const charge = w.billingState.charges.find((row) => row.sessionId === wed.id)!;
    w.billingState.charges.splice(w.billingState.charges.indexOf(charge), 1, {
      ...charge,
      paymentId: extra.id
    });
    const provider = w.mock.openDispute('mock_pi_extra', { amountCents: 6602 });
    await w.sync(provider.reference, at(AFTER_CAPTURE, 60));
    expect(w.dispute()).toMatchObject({
      scope: 'extra_session',
      paymentId: extra.id,
      cycleId: wed.cycleId
    });
    expect(w.cardDisputes.state.sessions.map((row) => [row.sessionId, row.disputedCents])).toEqual([
      [wed.id, 6602]
    ]);
  });

  it('a partial dispute is attributed across the sessions, cents exact', async () => {
    const { w } = await disputed({ amountCents: 5000 });
    expect(w.cardDisputes.state.sessions.map((row) => row.disputedCents)).toEqual([2500, 2500]);
  });

  it('an inquiry takes no money: no ledger, but refunds wait while it is open', async () => {
    const { w, payment } = await disputed({ inquiry: true });
    expect(w.dispute()).toMatchObject({ status: 'warning_needs_response', withdrawnCents: 0 });
    expect(w.billingState.ledger.filter((e) => e.kind.startsWith('dispute_'))).toEqual([]);
    expect(w.payments.get(payment.id)!.lastError).toBe('card dispute opened');
  });

  it('won: the reinstatement is in the ledger, the flag is cleared, the admins told once', async () => {
    const { w, provider, payment, now } = await disputed();
    w.mock.closeDispute(provider.reference, 'won');
    await w.sync(provider.reference, at(now, 60));
    await w.sync(provider.reference, at(now, 61));
    expect(w.dispute()).toMatchObject({
      status: 'won',
      triage: 'resolved',
      reinstatedCents: FAMILY_TOTAL,
      feeCents: 1500
    });
    expect(w.dispute().closedAt).toEqual(at(now, 60));
    expect(
      w.billingState.ledger.filter((e) => e.kind === 'dispute_reinstated').map((e) => e.amountCents)
    ).toEqual([FAMILY_TOTAL]);
    expect(w.payments.get(payment.id)!.lastError).toBeNull();
    expect(w.alerts.filter((s) => s.startsWith('Card dispute won'))).toHaveLength(1);
  });

  it('lost: needs an allocation, and the payment is flagged as lost', async () => {
    const { w, provider, payment, now } = await disputed();
    w.mock.closeDispute(provider.reference, 'lost');
    await w.sync(provider.reference, at(now, 60));
    expect(w.dispute()).toMatchObject({ status: 'lost', triage: 'allocation_needed' });
    expect(w.payments.get(payment.id)!.lastError).toBe('card dispute lost');
    expect(w.alerts.filter((s) => s.startsWith('Card dispute lost'))).toHaveLength(1);
  });

  it('ignores a dispute on a payment Poppynz does not know (admins told)', async () => {
    const w = await charged();
    const provider = w.mock.openDispute('pi_unknown');
    expect(await w.sync(provider.reference, AFTER_CAPTURE)).toBe('unknown payment');
    expect(w.cardDisputes.state.disputes).toHaveLength(0);
    expect(w.alerts.some((s) => s.includes('unknown payment'))).toBe(true);
  });

  it('derives the triage from the provider and the allocations', () => {
    expect(deriveTriage({ status: 'needs_response', submissionCount: 0 }, [])).toBe(
      'needs_response'
    );
    expect(deriveTriage({ status: 'under_review', submissionCount: 1 }, [])).toBe(
      'evidence_submitted'
    );
    expect(deriveTriage({ status: 'lost', submissionCount: 1 }, [{ allocation: null }])).toBe(
      'allocation_needed'
    );
    expect(
      deriveTriage({ status: 'lost', submissionCount: 1 }, [{ allocation: 'poppynz_absorbs' }])
    ).toBe('resolved');
    expect(deriveTriage({ status: 'warning_closed', submissionCount: 0 }, [])).toBe('resolved');
  });
});

const lateCancel = {
  kind: 'family_cancelled_late' as const,
  status: 'confirmed' as const,
  reportedBySide: 'family' as const
};

describe('refunds on a disputed charge', () => {
  const withRefundWaiting = async () => {
    const setup = await disputed();
    const { w, now } = setup;
    const session = w.sessionOn('2026-11-04');
    w.resolutions.state.resolutions.push(
      dummySessionResolution({
        id: 'res-late',
        contractId: 'contract-1',
        sessionId: session.id,
        cycleId: session.cycleId,
        ...lateCancel,
        recordedAt: new Date('2026-11-04T08:00:00.000Z')
      })
    );
    await w.provide(reconcileSession('contract-1', session.id, now));
    return setup;
  };

  it('wait while the dispute is open', async () => {
    const { w } = await withRefundWaiting();
    expect(w.money.state.refunds[0]).toMatchObject({
      status: 'pending',
      failureReason: 'a card dispute is open on this charge — the refund waits'
    });
    expect(w.mock.refunds()).toHaveLength(0);
  });

  it('go out once it is won', async () => {
    const { w, provider, now } = await withRefundWaiting();
    w.mock.closeDispute(provider.reference, 'won');
    await w.sync(provider.reference, at(now, 30));
    await w.tick(at(now, 45));
    expect(w.money.state.refunds[0]).toMatchObject({ status: 'succeeded', totalCents: 5039 });
    expect(w.mock.refunds()).toHaveLength(1);
  });

  it('go to the failure list (never sent) once it is lost: the bank already paid back', async () => {
    const { w, provider, now } = await withRefundWaiting();
    w.mock.closeDispute(provider.reference, 'lost');
    await w.sync(provider.reference, at(now, 30));
    await w.tick(at(now, 45));
    expect(w.money.state.refunds[0]).toMatchObject({ status: 'failed' });
    expect(w.money.state.refunds[0]!.failureReason).toContain(
      'card dispute on this charge was lost'
    );
    expect(w.mock.refunds()).toHaveLength(0);
    expect(w.alerts.some((s) => s.startsWith('A refund waits on a lost card dispute'))).toBe(true);
    // The family hears nothing about a "failed refund".
    expect(w.mailTo('family').some((s) => s.includes("didn't go through"))).toBe(false);
  });
});

describe('helper pay on disputed sessions', () => {
  it('is held at the cycle’s transfer while the dispute is open, and paid once it is won', async () => {
    const { w, provider } = await disputed();
    await w.tick(at(TRANSFER_1, 1));
    expect(w.money.state.transfers[0]).toMatchObject({ status: 'settled', amountCents: 0 });
    expect(w.money.state.items.map((item) => [item.kind, item.amountCents])).toEqual([
      ['held', 0],
      ['held', 0]
    ]);
    expect(
      w.billingState.ledger.filter((e) => e.kind === 'transfer_held').map((e) => e.amountCents)
    ).toEqual([5265, 5266]);
    w.mock.closeDispute(provider.reference, 'won');
    await w.sync(provider.reference, at(TRANSFER_1, 30));
    await w.tick(at(TRANSFER_1, 45));
    await w.tick(at(TRANSFER_1, 60));
    expect(w.money.state.transfers.map((t) => [t.sequence, t.status, t.amountCents])).toEqual([
      [1, 'settled', 0],
      [2, 'sent', 5265 + 5266]
    ]);
  });

  it('already paid when the dispute opens: never reversed, nothing held', async () => {
    const w = await charged();
    await w.tick(at(TRANSFER_1, 1));
    expect(w.money.state.transfers[0]).toMatchObject({ status: 'sent', amountCents: 10531 });
    const payment = await w.cyclePayment();
    const provider = w.mock.openDispute(payment.providerReference!);
    await w.sync(provider.reference, at(TRANSFER_1, 30));
    await w.tick(at(TRANSFER_1, 60));
    expect(w.money.state.transfers).toHaveLength(1);
    expect(w.mock.transfers()).toHaveLength(1);
    expect(w.money.state.recoveries).toHaveLength(0);
  });

  it('a held session stays held while a lost dispute waits for its allocation', () => {
    const row = (overrides: object) => ({
      sessionId: 's',
      disputeId: 'd',
      status: 'needs_response',
      closed: false,
      allocation: null,
      helperForfeitCents: 0,
      ...overrides
    });
    expect(cardDisputeHold([row({})], 's')).toEqual({ held: true, forfeitCents: 0 });
    expect(cardDisputeHold([row({ status: 'lost', closed: true })], 's').held).toBe(true);
    expect(
      cardDisputeHold(
        [
          row({
            status: 'lost',
            closed: true,
            allocation: 'helper_not_provided',
            helperForfeitCents: 900
          })
        ],
        's'
      )
    ).toEqual({ held: false, forfeitCents: 900 });
    expect(cardDisputeHold([row({ status: 'won', closed: true })], 's').held).toBe(false);
    expect(cardDisputeHold([row({})], 'other')).toEqual({ held: false, forfeitCents: 0 });
  });
});

describe('a lost dispute: the admin’s allocation per session', () => {
  const lost = async (options: { paidFirst?: boolean } = {}) => {
    const w = await charged();
    if (options.paidFirst) await w.tick(at(TRANSFER_1, 1));
    const payment = await w.cyclePayment();
    const provider = w.mock.openDispute(payment.providerReference!);
    const now = at(TRANSFER_1, 20);
    await w.sync(provider.reference, now);
    w.mock.closeDispute(provider.reference, 'lost');
    await w.sync(provider.reference, at(now, 5));
    if (!options.paidFirst) await w.tick(at(TRANSFER_1, 30));
    return { w, provider, now: at(now, 10) };
  };
  const ids = (w: Awaited<ReturnType<typeof lost>>['w']) => ({
    mon: w.sessionOn('2026-11-02').id,
    wed: w.sessionOn('2026-11-04').id
  });

  it('Poppynz absorbs one, the helper did not provide the other (pay not sent yet: withheld)', async () => {
    const { w, now } = await lost();
    const { mon, wed } = ids(w);
    // The cycle's transfer held both sessions while the dispute was undecided.
    expect(w.money.state.transfers[0]).toMatchObject({ status: 'settled', amountCents: 0 });
    const intents = w.mock.intents().length;
    await w.provide(
      allocateLostCardDispute(
        w.dispute().id,
        [
          { sessionId: mon, allocation: 'poppynz_absorbs', reason: 'processing error' },
          { sessionId: wed, allocation: 'helper_not_provided', reason: 'helper did not come' }
        ],
        ADMIN,
        now
      )
    );
    expect(w.dispute().triage).toBe('resolved');
    expect(
      w.cardDisputes.state.sessions.map((row) => [
        row.allocation,
        row.helperForfeitCents,
        row.recoveryId
      ])
    ).toEqual([
      ['poppynz_absorbs', 0, null],
      ['helper_not_provided', 5266, null]
    ]);
    expect(w.money.state.recoveries).toHaveLength(0);
    // Nothing is ever charged to the family again.
    expect(w.mock.intents()).toHaveLength(intents);
    await w.tick(at(now, 15));
    await w.tick(at(now, 30));
    // Only Monday's pay goes out: Wednesday's is withheld.
    expect(w.money.state.transfers.map((t) => [t.sequence, t.status, t.amountCents])).toEqual([
      [1, 'settled', 0],
      [2, 'sent', 5265]
    ]);
    expect(
      w.billingState.ledger
        .filter((e) => ['platform_absorbed', 'helper_recovery'].includes(e.kind))
        .map((e) => [e.kind, e.amountCents])
    ).toEqual([
      ['platform_absorbed', 6604],
      ['helper_recovery', 5266]
    ]);
    expect(w.money.state.audit.map((row) => [row.entity, row.action, row.actorUserId])).toEqual([
      ['card_dispute', 'session_poppynz_absorbs', ADMIN],
      ['card_dispute', 'session_helper_not_provided', ADMIN]
    ]);
    const notice = w.mails.find((mail) => mail.subject.startsWith('Payment for'));
    expect(notice?.email).toBe('helper-1@example.test');
    expect(notice?.paragraphs.join(' ')).toContain('$52.66 for this session will not be paid');
    expect(notice?.paragraphs.join(' ')).toContain('helper did not come');
  });

  it('pay already sent: a recovery from the helper’s future transfers, never a reversal', async () => {
    const { w, now } = await lost({ paidFirst: true });
    const { wed } = ids(w);
    await w.provide(
      allocateLostCardDispute(
        w.dispute().id,
        [{ sessionId: wed, allocation: 'helper_not_provided', reason: 'no-show confirmed' }],
        ADMIN,
        now
      )
    );
    expect(w.money.state.recoveries).toEqual([
      expect.objectContaining({
        helperUserId: 'helper-1',
        sessionId: wed,
        cardDisputeId: w.dispute().id,
        amountCents: 5266,
        status: 'outstanding'
      })
    ]);
    expect(w.mock.transfers()).toHaveLength(1);
    expect(w.mock.transfers()[0]!.reversedCents).toBe(0);
    // Monday still waits for its allocation.
    expect(w.dispute().triage).toBe('allocation_needed');
    expect(
      w.mails.find((mail) => mail.subject.startsWith('Payment for'))?.paragraphs.join(' ')
    ).toContain('deducted from your next payouts');
  });

  it('refuses: not lost, unknown session, twice, no reason, a forfeit above the share', async () => {
    const open = await disputed();
    const session = open.w.sessionOn('2026-11-02').id;
    const refusal = async (
      w: Awaited<ReturnType<typeof lost>>['w'],
      items: Parameters<typeof allocateLostCardDispute>[1]
    ) => {
      const result = await w.either(
        allocateLostCardDispute(w.dispute().id, items, ADMIN, new Date())
      );
      return Either.isLeft(result) ? (result.left as { reason: string }).reason : 'ok';
    };
    expect(
      await refusal(open.w, [{ sessionId: session, allocation: 'poppynz_absorbs', reason: null }])
    ).toBe('not_lost');
    const { w } = await lost();
    const { mon } = ids(w);
    expect(
      await refusal(w, [{ sessionId: 'nope', allocation: 'poppynz_absorbs', reason: null }])
    ).toBe('unknown_session');
    expect(
      await refusal(w, [{ sessionId: mon, allocation: 'helper_not_provided', reason: ' ' }])
    ).toBe('reason_required');
    expect(
      await refusal(w, [
        {
          sessionId: mon,
          allocation: 'helper_not_provided',
          reason: 'x',
          helperForfeitCents: 99_999
        }
      ])
    ).toBe('forfeit_too_high');
    expect(
      await refusal(w, [{ sessionId: mon, allocation: 'poppynz_absorbs', reason: null }])
    ).toBe('ok');
    expect(
      await refusal(w, [{ sessionId: mon, allocation: 'poppynz_absorbs', reason: null }])
    ).toBe('already_allocated');
  });

  it('the default forfeit is the helper’s share of the disputed part (half up)', () => {
    expect(
      defaultHelperForfeit({ helperShareCents: 5266, familyTotalCents: 6602, disputedCents: 6602 })
    ).toBe(5266);
    // 5266 × 2500 / 6602 = 1994.0…
    expect(
      defaultHelperForfeit({ helperShareCents: 5266, familyTotalCents: 6602, disputedCents: 2500 })
    ).toBe(1994);
    expect(
      defaultHelperForfeit({ helperShareCents: 5266, familyTotalCents: 6602, disputedCents: 0 })
    ).toBe(0);
  });
});

describe('the admin suspends and resumes the family’s contracts', () => {
  it('suspends with a reason (audited, neutral notices); only an admin resumes', async () => {
    const { w, now } = await disputed();
    const suspended = await w.provide(
      suspendFamilyContracts(
        {
          familyUserId: 'family-1',
          reason: 'suspected_fraud',
          note: 'card reported stolen',
          disputeId: w.dispute().id
        },
        ADMIN,
        now
      )
    );
    expect(suspended).toEqual(['contract-1']);
    expect(w.billing()).toMatchObject({ status: 'suspended', suspendedReason: 'admin_review' });
    expect(w.money.state.audit.at(-1)).toMatchObject({
      entity: 'family_billing',
      entityId: 'family-1',
      action: 'contracts_suspended',
      actorUserId: ADMIN,
      note: 'card reported stolen'
    });
    expect(w.mailTo('family')).toContain('Your contract is under review');
    const familyMail = w.mails.find((mail) => mail.subject === 'Your contract is under review')!;
    expect(familyMail.paragraphs.join(' ')).not.toMatch(/dispute|chargeback|bank/i);
    expect(w.mailTo('helper')).toContain('Contract with Fam I. paused');
    // The tick and a replaced card never lift an admin's hold.
    await w.tick(at(now, 60 * 24));
    await w.retry(at(now, 60 * 25));
    expect(w.billing()).toMatchObject({ status: 'suspended', suspendedReason: 'admin_review' });
    // Later cycles are suspended as they start, never held.
    await w.tick(new Date('2026-11-09T06:00:00.000Z'));
    expect(
      (await w.cycles()).slice(1).every((c) => !['authorised', 'captured'].includes(c.status))
    ).toBe(true);
    const state = await w.provide(familyReviewState('family-1'));
    expect(state).toMatchObject({ suspended: true, contractIds: ['contract-1'] });
    expect(state.history[0]).toMatchObject({
      action: 'contracts_suspended',
      reason: 'suspected_fraud'
    });
    // Nothing more to suspend.
    const again = await w.either(
      suspendFamilyContracts(
        {
          familyUserId: 'family-1',
          reason: 'unreliable_payment_method',
          note: 'x',
          disputeId: null
        },
        ADMIN,
        now
      )
    );
    expect(Either.isLeft(again) && again.left.reason).toBe('nothing_to_suspend');
    const resumed = await w.provide(
      resumeFamilyContracts(
        { familyUserId: 'family-1', note: 'cleared with the bank' },
        ADMIN,
        new Date('2026-11-09T07:00:00.000Z')
      )
    );
    expect(resumed).toEqual(['contract-1']);
    expect(w.billing().suspendedReason).not.toBe('admin_review');
    expect(w.money.state.audit.at(-1)).toMatchObject({
      action: 'contracts_resumed',
      note: 'cleared with the bank'
    });
    expect(w.mailTo('family')).toContain('Contract with Sam T. resumed');
    expect(w.mailTo('helper')).toContain('Contract with Fam I. resumed');
    const nothing = await w.either(
      resumeFamilyContracts({ familyUserId: 'family-1', note: 'x' }, ADMIN, new Date())
    );
    expect(Either.isLeft(nothing) && nothing.left.reason).toBe('nothing_to_resume');
  });

  it('future cycles are never suspended automatically by a dispute', async () => {
    const { w } = await disputed();
    expect(w.billing().status).toBe('active');
  });
});

describe('the evidence pack and its submission', () => {
  const message = (body: string, senderUserId: string, createdAt: string) => ({
    ...dummyConversationMessage,
    id: `m-${body}`,
    conversationId: 'conversation-1',
    senderUserId,
    body,
    createdAt: new Date(createdAt)
  });
  const options: WorldOptions = {
    contract: { conversationId: 'conversation-1' } as never,
    messages: [
      message('See you Monday at 3:30!', 'family-1', '2026-11-01T15:00:00.000Z'),
      message('Thanks, all went well today', 'family-1', '2026-11-02T23:30:00.000Z'),
      message('Too old to quote', 'family-1', '2026-09-01T15:00:00.000Z')
    ]
  };

  it('assembles the agreement, timetable, messages, charge records and refunds', async () => {
    const { w } = await disputed({}, options);
    const pack = await w.provide(assembleEvidencePack(w.dispute().id));
    expect(pack.agreement[0]).toMatchObject({
      side: 'family',
      sha256: 'a'.repeat(64),
      cancellationPolicyVersion: 3
    });
    expect(pack.sessions.map((row) => [row.date, row.disputedCents])).toEqual([
      ['2026-11-02', 6604],
      ['2026-11-04', 6602]
    ]);
    expect(pack.messages.map((row) => row.body)).toEqual([
      'See you Monday at 3:30!',
      'Thanks, all went well today'
    ]);
    expect(pack.payment).toMatchObject({ totalCents: FAMILY_TOTAL, capturedCents: FAMILY_TOTAL });
    expect(pack.cycle).toMatchObject({ startsOn: '2026-11-02', endsOn: '2026-11-04' });
    const summary = defaultEvidenceSummary(pack);
    expect(summary).toContain('signed the written service agreement');
    expect(summary).toContain('2 session(s)');
  });

  it('builds the provider’s fields within its limits, with the pack as PDFs', async () => {
    const { w } = await disputed({}, options);
    const pack = await w.provide(assembleEvidencePack(w.dispute().id));
    const evidence = buildEvidence(pack, 'Summary');
    expect(evidence.text).toMatchObject({
      uncategorized_text: 'Summary',
      customer_name: 'Fam Ily',
      customer_email_address: 'family-1@example.test',
      service_date: '2026-11-02 to 2026-11-04'
    });
    expect(evidence.text.cancellation_policy_disclosure).toContain('a'.repeat(64));
    expect(evidence.text.access_activity_log).toContain('Service agreement signed by the family');
    expect(evidence.communication[0]!.lines).toHaveLength(2);
    const huge = fitEvidenceText({
      uncategorized_text: 'u'.repeat(30_000),
      product_description: 'p'.repeat(30_000),
      access_activity_log: 'a'.repeat(30_000),
      refund_policy_disclosure: 'r'.repeat(30_000),
      cancellation_policy_disclosure: 'c'.repeat(30_000),
      cancellation_rebuttal: 'b'.repeat(30_000),
      customer_name: 'n'.repeat(6_000),
      service_date: 'd'.repeat(6_000)
    });
    expect(huge.uncategorized_text!.length).toBe(20_000);
    expect(huge.customer_name!.length).toBe(5_000);
    expect(Object.values(huge).reduce((t, v) => t + v!.length, 0)).toBeLessThanOrEqual(150_000);
  });

  it('submits once through the provider and records what was sent and when', async () => {
    const { w, provider, now } = await disputed({}, options);
    await w.provide(saveEvidenceSummary(w.dispute().id, 'Draft', ADMIN, now));
    expect(w.dispute()).toMatchObject({ evidenceSummary: 'Draft', evidenceSummaryByUserId: ADMIN });
    const submitted = await w.provide(
      submitCardDisputeEvidence(w.dispute().id, 'Final summary', ADMIN, at(now, 5))
    );
    expect(submitted).toMatchObject({
      submittedByUserId: ADMIN,
      submittedAt: at(now, 5),
      providerStatus: 'under_review'
    });
    expect(submitted.files.map((file) => file.field)).toEqual([
      'service_documentation',
      'customer_communication'
    ]);
    const [sent] = w.mock.disputeEvidence(provider.reference);
    expect(sent).toMatchObject({
      submit: true,
      text: expect.objectContaining({ uncategorized_text: 'Final summary' }),
      files: { service_documentation: 'mock_file_1', customer_communication: 'mock_file_2' },
      metadata: { card_dispute_id: w.dispute().id }
    });
    expect(w.dispute()).toMatchObject({ triage: 'evidence_submitted', status: 'under_review' });
    expect(w.money.state.audit.map((row) => row.action)).toEqual([
      'evidence_summary_saved',
      'evidence_submitted'
    ]);
    const again = await w.either(
      submitCardDisputeEvidence(w.dispute().id, 'Again', ADMIN, at(now, 6))
    );
    expect(Either.isLeft(again) && again.left.reason).toBe('already_submitted');
  });

  it('refuses an empty summary, and reports a provider refusal', async () => {
    const { w, now } = await disputed();
    const empty = await w.either(submitCardDisputeEvidence(w.dispute().id, '  ', ADMIN, now));
    expect(Either.isLeft(empty) && empty.left.reason).toBe('summary_required');
    const refusing = await disputed(
      {},
      {
        payments: (mock) => ({
          updateDisputeEvidence: () =>
            Effect.fail(
              new (require('@repo/payments').PaymentProviderError)({
                operation: 'updateDispute',
                cause: 'x',
                refusal: 'Evidence is limited to 150000 total characters for this dispute.'
              })
            )
        })
      }
    );
    const refused = await refusing.w.either(
      submitCardDisputeEvidence(refusing.w.dispute().id, 'S', ADMIN, refusing.now)
    );
    expect(Either.isLeft(refused) && refused.left).toMatchObject({
      reason: 'refused',
      detail: expect.stringContaining('150000')
    });
    expect(refusing.w.dispute().triage).toBe('needs_response');
  });

  it('renders a valid, page-capped PDF with French accents', () => {
    const bytes = renderTextPdf('Évidence', [{ heading: 'Séances', lines: ['Café “ok” – fin'] }]);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('\\311vidence');
    const pages = layoutPages('T', [{ heading: 'H', lines: Array(5000).fill('line') }], 3);
    expect(pages).toHaveLength(3);
    expect(pages[2]!.at(-1)!.text).toContain('more page(s) left out');
    expect(wrapLine('a '.repeat(80).trim(), 20).every((line) => line.length <= 20)).toBe(true);
    // xref offsets point at the objects.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
  });
});

describe('the evidence reminder tick', () => {
  it('reminds once, CONTRACT_DISPUTE_EVIDENCE_REMINDER_HOURS (72) before the deadline', async () => {
    const due = new Date('2026-11-10T23:59:59.000Z');
    const { w } = await disputed({ dueBy: due });
    const tick = (now: Date) => w.provide(runCardDisputeTick(now));
    const reminders = () => w.alerts.filter((s) => s.startsWith('Card dispute evidence due'));
    expect(await tick(new Date(due.getTime() - 73 * 3_600_000))).toEqual({
      reminded: 0,
      failed: 0
    });
    expect(await tick(new Date(due.getTime() - 71 * 3_600_000))).toEqual({
      reminded: 1,
      failed: 0
    });
    expect(await tick(new Date(due.getTime() - 60 * 3_600_000))).toEqual({
      reminded: 0,
      failed: 0
    });
    expect(reminders()).toEqual(['Card dispute evidence due in 71 h: $132.06 CAD (mock_du_1)']);
  });

  it('says nothing once evidence was submitted, or after the deadline', async () => {
    const due = new Date('2026-11-10T23:59:59.000Z');
    const { w, now } = await disputed({ dueBy: due });
    await w.provide(submitCardDisputeEvidence(w.dispute().id, 'S', ADMIN, now));
    expect(await w.provide(runCardDisputeTick(new Date(due.getTime() - 3_600_000)))).toEqual({
      reminded: 0,
      failed: 0
    });
    const late = await disputed({ dueBy: due });
    expect(await late.w.provide(runCardDisputeTick(new Date(due.getTime() + 1)))).toEqual({
      reminded: 0,
      failed: 0
    });
  });
});

describe('notice copy (EN/FR)', () => {
  const contract = { id: 'contract-1', familyUserId: 'f', providerUserId: 'h' } as never;
  const cases: Array<[CardDisputeNoticeKind, 'family' | 'helper']> = [
    ['review_suspended', 'family'],
    ['review_suspended', 'helper'],
    ['review_resumed', 'family'],
    ['review_resumed', 'helper'],
    ['helper_recovery', 'helper']
  ];
  it.each(cases)('%s to the %s exists in both languages', (kind, party) => {
    const ctx = {
      contract,
      session: { date: '2026-11-04', serviceName: 'Childcare' },
      amountCents: 5266,
      recovered: true,
      reason: 'no-show'
    };
    const names = { family: 'Fam Ily', helper: 'Sam Taylor' };
    const en = cardDisputeNoticeCopy(kind, party, ctx, names, 'en')!;
    const fr = cardDisputeNoticeCopy(kind, party, ctx, names, 'fr')!;
    expect(en.subject.length).toBeGreaterThan(0);
    expect(fr.subject.length).toBeGreaterThan(0);
    expect(fr.subject).not.toBe(en.subject);
    expect(fr.paragraphs.length).toBe(en.paragraphs.length);
  });

  it('the family is never told about a recovery, nor about the bank dispute', () => {
    const names = { family: 'Fam Ily', helper: 'Sam Taylor' };
    expect(
      cardDisputeNoticeCopy('helper_recovery', 'family', { contract } as never, names, 'en')
    ).toBeNull();
    for (const locale of ['en', 'fr'] as const) {
      const copy = cardDisputeNoticeCopy(
        'review_suspended',
        'family',
        { contract } as never,
        names,
        locale
      )!;
      expect([copy.subject, ...copy.paragraphs].join(' ')).not.toMatch(
        /dispute|contest|chargeback|banque|bank/i
      );
    }
  });
});
