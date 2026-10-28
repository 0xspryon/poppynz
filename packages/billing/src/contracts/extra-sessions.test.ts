import { describe, expect, it } from 'bun:test';
import { dummySessionResolution, type ExtraSession } from '@repo/db';
import { Effect, Either } from 'effect';
import { applyBps } from '../pricing';
import { CycleSettlement } from '../settle';
import {
  answerExtraSession,
  cancelExtraSession,
  CycleSettlementLive,
  proposeExtraSession,
  quoteExtraSession,
  retryExtraSessionCharges,
  runExtraSessionTick,
  settleExtraSessionRow,
  withdrawExtraSession,
  type ExtraSessionSlot
} from './extra-sessions';
import { extraSessionCopyFor } from './extra-session-notices';
import { reconcileSession, runSessionMoneyTick } from './money';
import { at, contract, CYCLE_1, FAMILY_TOTAL, makeWorld, type WorldOptions } from './test-world';

/**
 * Tier 3 step 3 (spec §1 step 3, §12 decisions 4–5): extra sessions. The
 * world is the step-2 one — Mon & Wed 15:30–18:00 at $25/h from Mon 2 Nov
 * 2026, Toronto; cycle 1 is Mon 2 – Wed 4 (held Sun 1 Nov, captured Mon
 * 07:00 EST, transferred Sat 7 Nov 00:00 EST), cycle 2 Thu 5 – Sat 7 has no
 * sessions ("Nothing to bill").
 */
const OCT_25 = new Date('2026-10-25T12:00:00.000Z');
const TRANSFER_1 = new Date('2026-11-07T05:00:00.000Z');
const HOUR = 60;

/** Tue 3 Nov, 10:00–12:00 EST: 2 h of Childcare, $50.00 of care. */
const TUESDAY: ExtraSessionSlot = {
  date: '2026-11-03',
  startMinutes: 600,
  endMinutes: 720,
  serviceId: 'svc-1'
};

type Side = 'family' | 'helper';
const actor = (side: Side) => ({ userId: side === 'family' ? 'family-1' : 'helper-1', side });

const world = (options: WorldOptions = {}) => {
  const w = makeWorld(options);
  const either = <A, E>(effect: Effect.Effect<A, E, never>) =>
    Effect.runPromise(Effect.either(effect));
  const provided = <A, E>(effect: Effect.Effect<A, E, any>) =>
    effect.pipe(Effect.provide(w.layer)) as Effect.Effect<A, E, never>;
  const refusalOf = (result: Either.Either<unknown, unknown>) =>
    Either.isLeft(result) ? (result.left as { reason?: string; _tag: string }) : null;
  const quote = async (slot: ExtraSessionSlot, now: Date) => {
    w.setClock(now);
    const result = await either(provided(quoteExtraSession('contract-1', slot, now)));
    if (Either.isLeft(result)) throw new Error(`no quote: ${JSON.stringify(result.left)}`);
    return result.right.amounts.familyTotalCents;
  };
  const propose = async (
    side: Side,
    slot: ExtraSessionSlot,
    now: Date,
    authorisedCents: number | null | 'quote' = 'quote'
  ) => {
    const auth =
      side === 'family' && authorisedCents === 'quote'
        ? await quote(slot, now)
        : authorisedCents === 'quote'
          ? null
          : authorisedCents;
    w.setClock(now);
    return either(
      provided(
        proposeExtraSession(
          'contract-1',
          actor(side),
          { ...slot, note: null, authorisedCents: auth },
          now
        )
      )
    );
  };
  const proposed = async (side: Side, slot: ExtraSessionSlot, now: Date) => {
    const result = await propose(side, slot, now);
    if (Either.isLeft(result)) throw new Error(`refused: ${JSON.stringify(result.left)}`);
    return result.right;
  };
  const answer = async (
    extra: ExtraSession,
    side: Side,
    response: 'accept' | 'decline',
    now: Date,
    authorisedCents: number | null | 'quote' = 'quote'
  ) => {
    // The family confirms the amount it is shown (the proposal's quote).
    const auth =
      side === 'family' && response === 'accept' && authorisedCents === 'quote'
        ? extra.quotedTotalCents
        : authorisedCents === 'quote'
          ? null
          : authorisedCents;
    w.setClock(now);
    return either(
      provided(
        answerExtraSession(
          'contract-1',
          extra.id,
          actor(side),
          { response, note: null, authorisedCents: auth },
          now
        )
      )
    );
  };
  /** Proposed by `by`, accepted by the other side. */
  const agreed = async (by: Side, slot: ExtraSessionSlot, now: Date) => {
    const extra = await proposed(by, slot, now);
    const result = await answer(extra, by === 'family' ? 'helper' : 'family', 'accept', at(now, 5));
    if (Either.isLeft(result)) throw new Error(`refused: ${JSON.stringify(result.left)}`);
    return result.right;
  };
  const withdraw = (extra: ExtraSession, side: Side, now: Date) =>
    either(provided(withdrawExtraSession('contract-1', extra.id, actor(side), now)));
  const cancel = (extra: ExtraSession, side: Side, now: Date) =>
    either(provided(cancelExtraSession('contract-1', extra.id, actor(side), now)));
  const extraTick = (now: Date) => {
    w.setClock(now);
    return w.run(provided(runExtraSessionTick(now)));
  };
  /** The worker's tick: billing, extra sessions, money. */
  const tick = async (now: Date) => {
    await w.step(now);
    const extra = await extraTick(now);
    const money = await w.run(provided(runSessionMoneyTick(now)));
    return { extra, money };
  };
  const extra = (id: string) => w.extras.state.extras.find((row) => row.id === id)!;
  const sessionOf = (row: ExtraSession) =>
    w.sessions().find((session) => session.id === extra(row.id).sessionId)!;
  const paymentsOf = (row: ExtraSession) =>
    [...w.payments.values()].filter(
      (payment) => payment.kind === 'contract_extra_session' && payment.chargeKey?.includes(row.id)
    );
  const cycle = (index: number) => w.billingState.cycles.find((row) => row.index === index)!;
  return {
    ...w,
    provided,
    refusalOf,
    quote,
    propose,
    proposed,
    answer,
    agreed,
    withdraw,
    cancel,
    extraTick,
    tick,
    extra,
    sessionOf,
    paymentsOf,
    cycle
  };
};

/** Cycle 1 held and captured as scheduled ($132.06). */
const captured = async (w: ReturnType<typeof world>) => {
  await w.tick(OCT_25);
  await w.tick(CYCLE_1.holdAt);
  await w.tick(CYCLE_1.captureAt);
  expect(w.cycle(0).status).toBe('captured');
};

describe('proposing an extra session — dates and rules', () => {
  it('lets the family propose with its authorisation, priced like a cycle, and tells both sides', async () => {
    const w = world();
    await w.tick(OCT_25);
    const total = await w.quote(TUESDAY, OCT_25);
    // 2 h × $25 = $50.00; fee 5% $2.50 + HST (ON) 13% $0.33 → $52.83.
    expect(total).toBe(5283);
    const row = await w.proposed('family', TUESDAY, OCT_25);
    expect(row).toMatchObject({
      status: 'proposed',
      proposedBySide: 'family',
      valueCents: 5000,
      elapsedMinutes: 120,
      quotedTotalCents: 5283,
      familyAuthorisedCents: 5283,
      familyAuthorisedAt: OCT_25,
      startsAt: new Date('2026-11-03T15:00:00.000Z'),
      endsAt: new Date('2026-11-03T17:00:00.000Z'),
      // CONTRACT_REPORT_RESPONSE_HOURS (48).
      respondBy: new Date('2026-10-27T12:00:00.000Z')
    });
    expect(w.extras.state.events.map((event) => [event.action, event.actorSide])).toEqual([
      ['proposed', 'family']
    ]);
    expect(w.mailTo('family-1')).toEqual(['You proposed an extra session on Tue, Nov 3']);
    expect(w.mailTo('helper-1')).toEqual(['Fam I. proposed an extra session on Tue, Nov 3']);
    // Nothing exists or is charged before the other side confirms.
    expect(w.sessions().filter((session) => session.origin === 'extra')).toEqual([]);
  });

  it('refuses a family proposal without its authorisation, or for another amount', async () => {
    const w = world();
    await w.tick(OCT_25);
    expect(w.refusalOf(await w.propose('family', TUESDAY, OCT_25, null))?.reason).toBe(
      'authorisation_required'
    );
    expect(w.refusalOf(await w.propose('family', TUESDAY, OCT_25, 5000))?.reason).toBe(
      'amount_changed'
    );
    // The helper authorises nothing: the family does, when it confirms.
    expect(Either.isRight(await w.propose('helper', TUESDAY, OCT_25, null))).toBe(true);
  });

  it(`reaches back exactly CONTRACT_EXTRA_SESSION_LOOKBACK_DAYS (14) days, no further`, async () => {
    const w = world();
    const NOV_20 = new Date('2026-11-20T17:00:00.000Z'); // Fri 20 Nov, noon EST
    await w.tick(OCT_25);
    await w.tick(NOV_20);
    // Fri 6 Nov is 14 days back; Thu 5 Nov is 15.
    const friday = { ...TUESDAY, date: '2026-11-06' };
    expect(Either.isRight(await w.propose('helper', friday, NOV_20))).toBe(true);
    expect(
      w.refusalOf(await w.propose('helper', { ...TUESDAY, date: '2026-11-05' }, NOV_20))?.reason
    ).toBe('too_far_back');
  });

  it('reaches forward to the end of the materialisation window, and stays within the contract', async () => {
    const w = world({ version: { endsOn: '2026-11-04', endsAtMinutes: 960 } });
    await w.tick(OCT_25);
    // Materialised through Wed 4 Nov (the contract's last day).
    expect(
      w.refusalOf(await w.propose('helper', { ...TUESDAY, date: '2026-11-05' }, OCT_25))?.reason
    ).toBe('outside_contract');
    expect(
      w.refusalOf(await w.propose('helper', { ...TUESDAY, date: '2026-11-01' }, OCT_25))?.reason
    ).toBe('outside_contract');
    // The last day ends at 16:00: a session past it is outside the contract.
    expect(
      w.refusalOf(
        await w.propose(
          'helper',
          { ...TUESDAY, date: '2026-11-04', startMinutes: 900, endMinutes: 1020 },
          OCT_25
        )
      )?.reason
    ).toBe('outside_contract');
    const open = world();
    await open.tick(OCT_25);
    // No end: the window (today + 14 − 1 = Sat 7 Nov) is the limit.
    expect(
      open.refusalOf(await open.propose('helper', { ...TUESDAY, date: '2026-11-08' }, OCT_25))
        ?.reason
    ).toBe('beyond_window');
    expect(
      Either.isRight(await open.propose('helper', { ...TUESDAY, date: '2026-11-07' }, OCT_25))
    ).toBe(true);
  });

  it('refuses an overlap with a scheduled session or an open proposal; touching is fine', async () => {
    const w = world();
    await w.tick(OCT_25);
    const monday = { ...TUESDAY, date: '2026-11-02' };
    // Mon 2 Nov has Childcare 15:30–18:00.
    expect(
      w.refusalOf(
        await w.propose('helper', { ...monday, startMinutes: 1020, endMinutes: 1140 }, OCT_25)
      )?.reason
    ).toBe('overlap');
    expect(
      Either.isRight(
        await w.propose('helper', { ...monday, startMinutes: 1080, endMinutes: 1140 }, OCT_25)
      )
    ).toBe(true);
    await w.proposed('helper', TUESDAY, OCT_25);
    expect(
      w.refusalOf(
        await w.propose('family', { ...TUESDAY, startMinutes: 660, endMinutes: 780 }, OCT_25, 9999)
      )?.reason
    ).toBe('overlap');
  });

  it('refuses times that are not one valid range within a day, and services not in the contract', async () => {
    const w = world();
    await w.tick(OCT_25);
    for (const slot of [
      { ...TUESDAY, startMinutes: 720, endMinutes: 600 },
      { ...TUESDAY, startMinutes: 600, endMinutes: 610 }, // under 15 minutes
      { ...TUESDAY, startMinutes: 1380, endMinutes: 1500 } // past midnight
    ]) {
      expect(w.refusalOf(await w.propose('helper', slot, OCT_25))?.reason).toBe('invalid_times');
    }
    expect(
      w.refusalOf(await w.propose('helper', { ...TUESDAY, serviceId: 'svc-9' }, OCT_25))?.reason
    ).toBe('unknown_service');
    // A session may run to midnight.
    expect(
      Either.isRight(
        await w.propose('helper', { ...TUESDAY, startMinutes: 1320, endMinutes: 1440 }, OCT_25)
      )
    ).toBe(true);
  });

  it('is only for a running contract with billing running', async () => {
    const ended = world({ contract: { status: 'ended' } });
    await ended.tick(OCT_25);
    expect(ended.refusalOf(await ended.propose('helper', TUESDAY, OCT_25))?.reason).toBe(
      'contract_not_active'
    );
    const ending = world({ contract: { status: 'ending' } });
    await ending.tick(OCT_25);
    expect(Either.isRight(await ending.propose('helper', TUESDAY, OCT_25))).toBe(true);
    const suspended = world();
    await suspended.tick(OCT_25);
    suspended.billingState.billing.set('contract-1', {
      ...suspended.billing(),
      status: 'suspended',
      suspendedReason: 'card'
    });
    expect(suspended.refusalOf(await suspended.propose('helper', TUESDAY, OCT_25))?.reason).toBe(
      'billing_unavailable'
    );
  });
});

describe('confirmation — explicit, never silence', () => {
  it("needs the family's authorisation to confirm the helper's proposal", async () => {
    const w = world();
    await w.tick(OCT_25);
    const extra = await w.proposed('helper', TUESDAY, OCT_25);
    expect(w.mailTo('family-1')).toEqual(['Sam T. proposed an extra session on Tue, Nov 3']);
    expect(
      w.refusalOf(await w.answer(extra, 'family', 'accept', at(OCT_25, 5), null))?.reason
    ).toBe('authorisation_required');
    const accepted = await w.answer(extra, 'family', 'accept', at(OCT_25, 5));
    expect(Either.isRight(accepted)).toBe(true);
    const row = w.extra(extra.id);
    expect(row).toMatchObject({
      status: 'agreed',
      familyAuthorisedCents: 5283,
      familyAuthorisedAt: at(OCT_25, 5),
      agreedAt: at(OCT_25, 5),
      // CONTRACT_EXTRA_SESSION_CHARGE_DELAY_MINUTES (60).
      chargeAt: at(OCT_25, 65),
      cycleId: w.cycle(0).id
    });
    // It is a real session now — an extra one, its charge still pending.
    expect(w.sessionOf(row)).toMatchObject({
      origin: 'extra',
      chargeRoute: 'pending',
      status: 'scheduled',
      cycleId: w.cycle(0).id,
      date: '2026-11-03',
      valueCents: 5000
    });
    expect(w.mailTo('family-1').at(-1)).toBe('Extra session confirmed for Tue, Nov 3');
    const confirmation = w.mails.filter((mail) => mail.email.startsWith('family-1')).at(-1)!;
    expect(confirmation.paragraphs[1]).toBe(
      "You'll be charged $52.83 for it in 1 hour unless either of you cancels it before then. Cancelling until then costs nothing."
    );
  });

  it("lets the helper confirm the family's proposal (already authorised)", async () => {
    const w = world();
    await w.tick(OCT_25);
    const extra = await w.proposed('family', TUESDAY, OCT_25);
    expect(Either.isRight(await w.answer(extra, 'helper', 'accept', at(OCT_25, 5)))).toBe(true);
    expect(w.extra(extra.id).status).toBe('agreed');
  });

  it('refuses answering your own proposal, and a declined proposal creates nothing', async () => {
    const w = world();
    await w.tick(OCT_25);
    const extra = await w.proposed('helper', TUESDAY, OCT_25);
    expect(w.refusalOf(await w.answer(extra, 'helper', 'accept', at(OCT_25, 5)))?.reason).toBe(
      'wrong_side'
    );
    expect(Either.isRight(await w.answer(extra, 'family', 'decline', at(OCT_25, 5)))).toBe(true);
    expect(w.extra(extra.id).status).toBe('declined');
    expect(w.sessions().some((session) => session.origin === 'extra')).toBe(false);
    // Answered once: the second answer finds nothing to answer.
    expect(w.refusalOf(await w.answer(extra, 'family', 'accept', at(OCT_25, 6)))?.reason).toBe(
      'nothing_to_answer'
    );
    expect(w.mailTo('helper-1').at(-1)).toBe('Fam I. declined the extra session (Tue, Nov 3)');
  });

  it('lapses unanswered after the response window — silence is never acceptance', async () => {
    const w = world();
    await w.tick(OCT_25);
    const extra = await w.proposed('helper', TUESDAY, OCT_25);
    await w.tick(at(OCT_25, 48 * HOUR - 1));
    expect(w.extra(extra.id).status).toBe('proposed');
    const summary = await w.tick(at(OCT_25, 48 * HOUR));
    expect(summary.extra.lapsed).toBe(1);
    expect(w.extra(extra.id).status).toBe('lapsed');
    expect(w.sessions().some((session) => session.origin === 'extra')).toBe(false);
    expect(w.mailTo('family-1').at(-1)).toBe('An extra session proposal lapsed (Tue, Nov 3)');
    expect(
      w.refusalOf(await w.answer(extra, 'family', 'accept', at(OCT_25, 48 * HOUR + 1)))?.reason
    ).toBe('nothing_to_answer');
    expect(w.extras.state.events.at(-1)).toMatchObject({ action: 'lapsed', actorSide: 'system' });
  });

  it('lets the proposer withdraw before an answer, and only the proposer', async () => {
    const w = world();
    await w.tick(OCT_25);
    const extra = await w.proposed('family', TUESDAY, OCT_25);
    expect(w.refusalOf(await w.withdraw(extra, 'helper', at(OCT_25, 1)))?.reason).toBe(
      'wrong_side'
    );
    expect(Either.isRight(await w.withdraw(extra, 'family', at(OCT_25, 1)))).toBe(true);
    expect(w.extra(extra.id).status).toBe('withdrawn');
    expect(w.refusalOf(await w.withdraw(extra, 'family', at(OCT_25, 2)))?.reason).toBe(
      'not_withdrawable'
    );
    // The slot is free again.
    expect(Either.isRight(await w.propose('helper', TUESDAY, at(OCT_25, 3)))).toBe(true);
  });
});

describe('the charge delay', () => {
  it('can be cancelled by either side within the delay, at no cost', async () => {
    const w = world();
    await w.tick(OCT_25);
    const extra = await w.agreed('helper', TUESDAY, OCT_25);
    expect(Either.isRight(await w.cancel(extra, 'helper', at(OCT_25, 30)))).toBe(true);
    expect(w.extra(extra.id).status).toBe('cancelled');
    expect(w.sessionOf(extra).status).toBe('cancelled');
    await w.tick(at(OCT_25, 2 * HOUR));
    expect(w.paymentsOf(extra)).toEqual([]);
    expect(w.mailTo('family-1').at(-1)).toBe('Sam T. cancelled the extra session (Tue, Nov 3)');
  });

  it('is charged when the delay ends and can no longer be cancelled for free', async () => {
    const w = world();
    await captured(w);
    const NOV_5 = new Date('2026-11-05T14:00:00.000Z');
    await w.tick(NOV_5);
    const extra = await w.agreed('helper', TUESDAY, NOV_5);
    await w.tick(at(NOV_5, 64));
    expect(w.extra(extra.id).status).toBe('agreed');
    expect(w.paymentsOf(extra)).toEqual([]);
    await w.tick(at(NOV_5, 65));
    expect(w.extra(extra.id).status).toBe('charged');
    expect(w.refusalOf(await w.cancel(extra, 'family', at(NOV_5, 66)))?.reason).toBe(
      'not_cancellable'
    );
  });
});

describe('the charge, by the cycle’s state', () => {
  it('folds into a cycle not held yet: the hold charges it with the cycle', async () => {
    const w = world();
    await w.tick(OCT_25);
    const extra = await w.agreed('helper', TUESDAY, OCT_25);
    const { extra: summary } = await w.tick(at(OCT_25, 65));
    expect(summary.folded).toBe(1);
    expect(w.extra(extra.id).status).toBe('in_cycle');
    expect(w.sessionOf(extra).chargeRoute).toBe('cycle');
    expect(w.paymentsOf(extra)).toEqual([]);
    await w.tick(CYCLE_1.holdAt);
    const held = w.cycle(0);
    expect(held.status).toBe('authorised');
    // $175.00 of care: fee $8.75 + HST $1.14 → $184.89.
    expect(held.familyTotalCents).toBe(18489);
    expect(held.chargedSessions.map((row) => row.sessionId)).toContain(w.sessionOf(extra).id);
    await w.tick(CYCLE_1.captureAt);
    expect(w.cycle(0).capturedCents).toBe(18489);
    const charges = w.billingState.charges.filter((row) => row.cycleId === w.cycle(0).id);
    expect(charges).toHaveLength(3);
    expect(charges.reduce((t, row) => t + row.familyTotalCents, 0)).toBe(18489);
  });

  it('folds into a held cycle when the re-quoted capture still fits under the hold', async () => {
    const w = world();
    await w.tick(OCT_25);
    await w.tick(CYCLE_1.holdAt);
    expect(w.cycle(0).heldCents).toBe(FAMILY_TOTAL);
    // Wed 4 Nov is cancelled in time: the capture would take Monday only.
    const wednesday = w.sessions().find((session) => session.date === '2026-11-04')!;
    w.resolutions.state.resolutions.push(
      dummySessionResolution({
        id: 'res-wed',
        contractId: 'contract-1',
        sessionId: wednesday.id,
        cycleId: wednesday.cycleId,
        kind: 'family_cancelled_early',
        status: 'confirmed',
        reportedBySide: 'family',
        recordedAt: at(CYCLE_1.holdAt, 10)
      })
    );
    const NOW = at(CYCLE_1.holdAt, 10);
    await w.run(w.provided(reconcileSession('contract-1', wednesday.id, NOW)));
    const extra = await w.agreed('helper', { ...TUESDAY, endMinutes: 660 }, NOW);
    await w.tick(at(NOW, 65));
    expect(w.extra(extra.id).status).toBe('in_cycle');
    await w.tick(CYCLE_1.captureAt);
    // Monday $62.50 + the extra hour $25.00 = $87.50 → fee $4.38 + HST $0.57.
    expect(w.cycle(0).capturedCents).toBe(9245);
    expect(w.paymentsOf(extra)).toEqual([]);
  });

  it('charges on its own payment when the held cycle can’t take it; the capture is unchanged', async () => {
    const w = world();
    await w.tick(OCT_25);
    await w.tick(CYCLE_1.holdAt);
    const NOW = at(CYCLE_1.holdAt, 10);
    const extra = await w.agreed('helper', TUESDAY, NOW);
    await w.tick(at(NOW, 65));
    const row = w.extra(extra.id);
    expect(row.status).toBe('charged');
    expect(w.sessionOf(extra).chargeRoute).toBe('separate');
    const [payment] = w.paymentsOf(extra);
    expect(payment).toMatchObject({
      kind: 'contract_extra_session',
      status: 'captured',
      amountCents: 5000,
      feeCents: 250,
      totalCents: 5283,
      capturedCents: 5283,
      chargeKey: `extra-${extra.id}-1`
    });
    await w.tick(CYCLE_1.captureAt);
    expect(w.cycle(0).capturedCents).toBe(FAMILY_TOTAL);
    expect(w.cycle(0).chargedSessions.map((s) => s.sessionId)).not.toContain(row.sessionId);
  });

  it('charges a past session on its own payment once the cycle is captured, split as one session', async () => {
    const w = world();
    await captured(w);
    const NOV_5 = new Date('2026-11-05T14:00:00.000Z');
    await w.tick(NOV_5);
    const extra = await w.agreed('helper', TUESDAY, NOV_5);
    await w.tick(at(NOV_5, 65));
    const row = w.extra(extra.id);
    expect(row.status).toBe('charged');
    const [payment] = w.paymentsOf(extra);
    const charge = w.billingState.charges.find((c) => c.sessionId === row.sessionId)!;
    // The split of one session is the session: care, fee, fee tax, the
    // contract's frozen commission and its tax, frozen on its own payment.
    expect(charge).toMatchObject({
      paymentId: payment!.id,
      cycleId: w.cycle(0).id,
      basis: 'session',
      careCents: 5000,
      familyFeeCents: 250,
      familyFeeTaxCents: 33,
      familyTotalCents: 5283,
      commissionCents: applyBps(5000, 1500),
      commissionTaxCents: 38,
      helperShareCents: 5000 - 750 - 38
    });
    expect(payment!.taxLines.map((line) => line.supplyType)).toEqual(['family_service_fee']);
    expect(row.taxLines.map((line) => line.supplyType)).toEqual([
      'family_service_fee',
      'provider_commission'
    ]);
    const ledger = w.billingState.ledger.filter((entry) =>
      entry.entryKey.startsWith(`extra:${extra.id}`)
    );
    expect(ledger.map((entry) => [entry.kind, entry.amountCents])).toEqual([
      ['session', 5000],
      ['family_fee', 250],
      ['family_fee_tax', 33],
      ['provider_commission', 750],
      ['provider_commission_tax', 38],
      ['capture', 5283]
    ]);
    expect(w.mailTo('family-1').at(-1)).toBe('You were charged $52.83 for an extra session');
    expect(w.mailTo('helper-1').at(-1)).toBe('The extra session on Tue, Nov 3 is paid');
  });

  it('charges a session added to a "Nothing to bill" cycle, and transfers it with that cycle', async () => {
    const w = world();
    await captured(w);
    const NOV_6 = new Date('2026-11-06T20:00:00.000Z'); // Fri 6 Nov, 15:00 EST
    await w.tick(NOV_6);
    expect(w.cycle(1).status).toBe('empty');
    const friday = { ...TUESDAY, date: '2026-11-06' };
    const extra = await w.agreed('family', friday, NOV_6);
    await w.tick(at(NOV_6, 65));
    expect(w.extra(extra.id).status).toBe('charged');
    // Cycle 2's transfer (Mon 9 Nov 00:00 EST) pays it.
    const TRANSFER_2 = new Date('2026-11-10T05:00:00.000Z');
    await w.tick(TRANSFER_2);
    const transfer = w.money.state.transfers.find((row) => row.cycleId === w.cycle(1).id)!;
    expect(transfer).toMatchObject({ status: 'sent', amountCents: 5000 - 750 - 38 });
    expect(transfer.sourceReference).toBe(`mock_ch_mock_pi_extra-${extra.id}-1`);
  });

  it('waits while the cycle’s money is in flight', async () => {
    const w = world();
    await w.tick(OCT_25);
    const extra = await w.agreed('helper', TUESDAY, OCT_25);
    w.billingState.cycles[0] = { ...w.cycle(0), status: 'authorising' };
    await w.extraTick(at(OCT_25, 65));
    expect(w.extra(extra.id).status).toBe('agreed');
  });
});

describe('idempotency', () => {
  it('charges once however often the tick runs or the payment is settled', async () => {
    const w = world();
    await captured(w);
    const NOV_5 = new Date('2026-11-05T14:00:00.000Z');
    await w.tick(NOV_5);
    const extra = await w.agreed('helper', TUESDAY, NOV_5);
    await w.tick(at(NOV_5, 65));
    await w.tick(at(NOV_5, 66));
    await w.extraTick(at(NOV_5, 66));
    const [payment] = w.paymentsOf(extra);
    expect(w.paymentsOf(extra)).toHaveLength(1);
    const charges = w.billingState.charges.length;
    const ledger = w.billingState.ledger.length;
    // A duplicate webhook, the browser and the recovery job: all no-ops,
    // through the settle path's contract branch too.
    await w.run(w.provided(settleExtraSessionRow(payment!, at(NOV_5, 67))));
    const viaSettlePath = await w.run(
      w.provided(
        Effect.flatMap(CycleSettlement, (settlement) =>
          settlement.settle(w.payments.get(payment!.id)!, at(NOV_5, 68))
        ).pipe(Effect.provide(CycleSettlementLive))
      )
    );
    expect(viaSettlePath.outcome).toBe('final');
    expect(w.billingState.charges.length).toBe(charges);
    expect(w.billingState.ledger.length).toBe(ledger);
    expect(w.extra(extra.id).status).toBe('charged');
  });

  it('replays an unanswered charge under the same key — never a second charge', async () => {
    let lose = false;
    const w = world({ mock: { loseResponses: () => lose } });
    await captured(w);
    const NOV_5 = new Date('2026-11-05T14:00:00.000Z');
    await w.tick(NOV_5);
    lose = false;
    const extra = await w.agreed('helper', TUESDAY, NOV_5);
    lose = true;
    await w.tick(at(NOV_5, 65));
    expect(w.extra(extra.id).status).toBe('charging');
    lose = false;
    await w.tick(at(NOV_5, 70));
    expect(w.extra(extra.id).status).toBe('charged');
    expect(w.paymentsOf(extra)).toHaveLength(1);
    expect(w.paymentsOf(extra)[0]!.chargeKey).toBe(`extra-${extra.id}-1`);
  });

  it('refuses a double confirmation', async () => {
    const w = world();
    await w.tick(OCT_25);
    const extra = await w.proposed('family', TUESDAY, OCT_25);
    const [first, second] = await Promise.all([
      w.answer(extra, 'helper', 'accept', at(OCT_25, 5)),
      w.answer(extra, 'helper', 'accept', at(OCT_25, 5))
    ]);
    expect([first, second].filter(Either.isRight)).toHaveLength(1);
    expect(w.sessions().filter((session) => session.origin === 'extra')).toHaveLength(1);
  });
});

describe('a declined card', () => {
  const declinedWorld = async () => {
    const w = world();
    await captured(w);
    const NOV_5 = new Date('2026-11-05T14:00:00.000Z');
    await w.tick(NOV_5);
    const extra = await w.agreed('helper', TUESDAY, NOV_5);
    w.setCard('mock_pm_decline');
    await w.tick(at(NOV_5, 65));
    return { w, extra, due: at(NOV_5, 65) };
  };

  it('never suspends the contract; tells the family to update the card', async () => {
    const { w, extra, due } = await declinedWorld();
    expect(w.extra(extra.id)).toMatchObject({
      status: 'charge_failed',
      chargeAttempts: 1,
      // CONTRACT_BILLING_RETRY_HOURS (12).
      nextRetryAt: at(due, 12 * HOUR)
    });
    expect(w.billing().status).toBe('active');
    expect(w.mailTo('family-1').at(-1)).toBe(
      'Your card was declined for an extra session — please update it'
    );
    expect(w.mailTo('helper-1').at(-1)).toBe(
      "The family's payment for the extra session on Tue, Nov 3 didn't go through"
    );
  });

  it('retries every CONTRACT_BILLING_RETRY_HOURS under a new key, and at once on a new card', async () => {
    const { w, extra, due } = await declinedWorld();
    await w.tick(at(due, 6 * HOUR));
    expect(w.paymentsOf(extra)).toHaveLength(1);
    await w.tick(at(due, 12 * HOUR));
    expect(w.paymentsOf(extra).map((row) => row.chargeKey)).toEqual([
      `extra-${extra.id}-1`,
      `extra-${extra.id}-2`
    ]);
    expect(w.extra(extra.id).status).toBe('charge_failed');
    // The family is told once, not on every retry.
    expect(w.mailTo('family-1').filter((s) => s.startsWith('Your card was declined'))).toHaveLength(
      1
    );
    w.setCard('mock_pm_new');
    const retried = await w.run(
      w.provided(retryExtraSessionCharges('family-1', at(due, 13 * HOUR)))
    );
    expect(retried).toBe(1);
    expect(w.extra(extra.id).status).toBe('charged');
  });

  it(`raises an admin incident once it is unpaid for CONTRACT_EXTRA_SESSION_UNPAID_ALERT_DAYS (7)`, async () => {
    const { w, extra, due } = await declinedWorld();
    await w.tick(at(due, 7 * 24 * HOUR - 1));
    expect(w.alerts.filter((subject) => subject.startsWith('Extra session unpaid'))).toEqual([]);
    await w.tick(at(due, 7 * 24 * HOUR));
    await w.tick(at(due, 7 * 24 * HOUR + 15));
    expect(w.alerts.filter((subject) => subject.startsWith('Extra session unpaid'))).toEqual([
      'Extra session unpaid on contract contract-1'
    ]);
    expect(w.billingState.incidents.map((row) => row.kind)).toContain(
      `extra_session_unpaid:${extra.id}`
    );
  });

  it('pays the helper only once the charge succeeds — in a follow-up from the extra charge', async () => {
    const { w, extra } = await declinedWorld();
    await w.tick(TRANSFER_1);
    const first = w.money.state.transfers.find((row) => row.cycleId === w.cycle(0).id)!;
    expect(first.status).toBe('sent');
    const sessionId = w.extra(extra.id).sessionId!;
    expect(w.money.state.items.some((item) => item.sessionId === sessionId)).toBe(false);
    w.setCard('mock_pm_new');
    await w.run(w.provided(retryExtraSessionCharges('family-1', at(TRANSFER_1, 60))));
    expect(w.extra(extra.id).status).toBe('charged');
    await w.tick(at(TRANSFER_1, 75));
    const followUp = w.money.state.transfers.find(
      (row) => row.cycleId === w.cycle(0).id && row.sequence === 2
    )!;
    expect(followUp).toMatchObject({ status: 'sent', amountCents: 5000 - 750 - 38 });
    // Sourced from the extra session's own charge, which it fits under.
    expect(followUp.sourceReference).toBe(
      `mock_ch_mock_pi_extra-${extra.id}-${w.extra(extra.id).chargeAttempts}`
    );
    expect(
      w.money.state.items.filter((item) => item.transferId === followUp.id).map((i) => i.sessionId)
    ).toEqual([sessionId]);
  });

  it('is abandoned when its session no longer takes place', async () => {
    const { w, extra, due } = await declinedWorld();
    const session = w.sessionOf(extra);
    w.billingState.sessions = w.billingState.sessions.map((row) =>
      row.id === session.id ? { ...row, status: 'cancelled' as const } : row
    );
    await w.tick(at(due, 12 * HOUR));
    expect(w.extra(extra.id).status).toBe('cancelled');
    expect(w.paymentsOf(extra)).toHaveLength(1);
  });
});

describe('after it exists, a normal session', () => {
  it('is refunded on its own payment', async () => {
    const w = world();
    await captured(w);
    const NOV_5 = new Date('2026-11-05T14:00:00.000Z');
    await w.tick(NOV_5);
    const extra = await w.agreed('helper', TUESDAY, NOV_5);
    await w.tick(at(NOV_5, 65));
    const row = w.extra(extra.id);
    w.resolutions.state.resolutions.push(
      dummySessionResolution({
        id: 'res-extra',
        contractId: 'contract-1',
        sessionId: row.sessionId!,
        cycleId: row.cycleId!,
        kind: 'helper_no_show',
        status: 'confirmed',
        reportedBySide: 'family'
      })
    );
    const result = await w.run(
      w.provided(reconcileSession('contract-1', row.sessionId!, at(NOV_5, 90)))
    );
    expect(result).toBe('refund');
    const [refund] = w.money.state.refunds;
    expect(refund).toMatchObject({
      paymentId: row.paymentId,
      sessionId: row.sessionId,
      totalCents: 5283,
      status: 'succeeded'
    });
  });
});

describe('notices in both languages', () => {
  const extraRow = {
    id: 'extra-1',
    contractId: 'contract-1',
    date: '2026-11-03',
    startMinutes: 600,
    endMinutes: 720,
    serviceName: 'Garde d’enfants',
    quotedTotalCents: 5283,
    familyTotalCents: null,
    respondBy: new Date('2026-10-27T12:00:00.000Z'),
    cycleId: 'cycle-1'
  } as unknown as ExtraSession;
  const ctx = (actorUserId: string | null) => ({
    contract: contract(),
    extra: extraRow,
    actorUserId,
    zone: 'America/Toronto',
    chargeDelayMinutes: 60,
    retryHours: 12
  });
  const names = { family: 'Priya T.', helper: 'Maria T.' };
  /** French formatting uses no-break spaces ("52,83 $"). */
  const plain = (text: string | undefined) => (text ?? '').replace(/\s/g, ' ');

  it('asks the family to confirm and authorise, in French', () => {
    const copy = extraSessionCopyFor('proposed', 'family', ctx('helper-1'), names, 'fr');
    expect(copy.subject).toBe('Maria T. propose une séance supplémentaire le mar. 3 nov.');
    expect(plain(copy.paragraphs[1])).toContain('Poppynz prélève 52,83 $ sur votre carte');
  });

  it('states the delay and the amount once agreed, in both languages', () => {
    expect(
      extraSessionCopyFor('agreed', 'family', ctx('helper-1'), names, 'en').paragraphs[1]
    ).toBe(
      "You'll be charged $52.83 for it in 1 hour unless either of you cancels it before then. Cancelling until then costs nothing."
    );
    expect(
      plain(extraSessionCopyFor('agreed', 'family', ctx('helper-1'), names, 'fr').paragraphs[1])
    ).toBe(
      '52,83 $ sera prélevé sur votre carte dans 1 heure, à moins que l’un de vous ne l’annule d’ici là. L’annuler d’ici là ne coûte rien.'
    );
  });

  it('asks the family to update the card on a decline, in French', () => {
    const copy = extraSessionCopyFor('charge_failed', 'family', ctx(null), names, 'fr');
    expect(copy.link).toBe('card');
    expect(copy.paragraphs[1]).toContain('toutes les 12 heures');
  });
});
