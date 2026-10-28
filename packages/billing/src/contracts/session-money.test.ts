import { describe, expect, it } from 'bun:test';
import { dummySessionResolution } from '@repo/db';
import { quoteContractAmounts, splitCycleCharge, type SessionChargeSplit } from '../pricing';
import { seededSnapshot } from '../pricing/test-snapshot';
import {
  effectiveSessionOutcome,
  resolveSessionMoney,
  type MoneySession,
  type SessionMoneyPolicy
} from './session-money';

const ZONE = 'America/Toronto';
const policy: SessionMoneyPolicy = {
  version: 1,
  lateCancellationHelperBps: 2500,
  cancellationNoticeHours: 24
};

/** The §5 worked example: two $62.50 sessions, ON family, MB helper. */
const workedExample = () => {
  const quote = quoteContractAmounts({
    serviceCents: 12_500,
    familyFeeBps: 500,
    providerCommissionBps: 1500,
    snapshot: seededSnapshot(),
    on: '2026-11-02',
    familyProvince: 'ON',
    helperProvince: 'MB'
  });
  if (!quote.ok) throw new Error('quote');
  return splitCycleCharge({
    sessions: [
      {
        sessionId: 'mon',
        startsAt: new Date('2026-11-02T14:00:00Z'),
        slot: 'a@540',
        valueCents: 6250
      },
      {
        sessionId: 'wed',
        startsAt: new Date('2026-11-04T14:00:00Z'),
        slot: 'a@540',
        valueCents: 6250
      }
    ],
    carriedInCents: 0,
    serviceTaxLines: quote.amounts.serviceTaxLines,
    familyFeeCents: quote.amounts.familyFeeCents,
    familyFeeTaxLines: quote.amounts.familyFeeTaxLines,
    providerCommissionCents: quote.amounts.providerCommissionCents,
    providerCommissionTaxLines: quote.amounts.providerCommissionTaxLines,
    compensationTaxLines: []
  }).sessions;
};
const [mon, wed] = workedExample() as [SessionChargeSplit, SessionChargeSplit];

/** Wednesday 2026-11-04, 9:00–14:00 in Toronto (EST), 5 h. */
const wedSession: MoneySession = { date: '2026-11-04', startMinutes: 540, elapsedMinutes: 300 };
// 24 h before on the clock: Tue 2026-11-03 9:00 EST = 14:00Z.
const CUTOFF = new Date('2026-11-03T14:00:00.000Z');

const money = (
  split: SessionChargeSplit,
  overrides: Parameters<typeof dummySessionResolution>[0] | null,
  session: MoneySession = wedSession
) =>
  resolveSessionMoney(
    split,
    {
      resolution: overrides === null ? null : dummySessionResolution(overrides),
      session,
      zone: ZONE
    },
    policy
  );

/** The cents always add up: what the family paid = refund + helper + Poppynz. */
const balanced = (split: SessionChargeSplit, result: ReturnType<typeof money>) => {
  if (result.held) return;
  expect(
    result.familyRefund.totalCents + result.helperOwed.totalCents + result.poppynzKeeps.totalCents
  ).toBe(split.familyTotalCents);
};

describe('resolveSessionMoney — policy v1 (spec §6)', () => {
  it('nothing in effect: the helper is paid the frozen share, nothing is refunded', () => {
    const result = money(wed, null);
    expect(result).toMatchObject({ outcome: 'none', held: false });
    expect(result.familyRefund.totalCents).toBe(0);
    expect(result.helperOwed.totalCents).toBe(wed.helperShareCents);
    expect(result.poppynzKeeps.totalCents).toBe(312 + 40 + 937 + 47);
    balanced(wed, result);
  });

  it('family cancels late (the spec example): Hana $15.63, family $50.39 back', () => {
    const result = money(wed, {
      kind: 'family_cancelled_late',
      status: 'confirmed',
      reportedBySide: 'family',
      recordedAt: new Date('2026-11-04T08:00:00.000Z')
    });
    expect(result.outcome).toBe('family_late');
    expect(result.helperOwed).toMatchObject({
      compensationCents: 1563,
      workedCents: 0,
      totalCents: 1563
    });
    expect(result.familyRefund).toMatchObject({
      careCents: 6250 - 1563,
      feeCents: 312,
      totalCents: 5039
    });
    expect(result.familyRefund.feeTaxLines[0]).toMatchObject({
      label: 'HST (ON) 13%',
      taxCents: 40
    });
    // No commission on cancelled hours.
    expect(result.poppynzKeeps.totalCents).toBe(0);
    expect(result.commissionReversal).toMatchObject({
      commissionCents: 937,
      commissionTaxCents: 47
    });
    expect(1563 + 5039).toBe(6602);
    balanced(wed, result);
  });

  it('rounds the compensation half up for the helper', () => {
    // 25 % of 62.50 = 15.625 → 15.63; of 62.49 = 15.6225 → 15.62.
    const split = {
      ...wed,
      careCents: 6249,
      familyTotalCents: 6249 + 312 + 40,
      helperShareCents: 6249 - 937 - 47
    };
    const result = money(split, {
      kind: 'family_no_show',
      status: 'confirmed',
      reportedBySide: 'helper'
    });
    expect(result.helperOwed.compensationCents).toBe(1562);
    balanced(split, result);
  });

  it('family cancels at least 24 h before (early): full refund, helper $0, Poppynz $0', () => {
    const result = money(wed, {
      kind: 'family_cancelled_early',
      status: 'confirmed',
      reportedBySide: 'family',
      recordedAt: CUTOFF
    });
    expect(result.outcome).toBe('family_early');
    expect(result.familyRefund.totalCents).toBe(6602);
    expect(result.helperOwed.totalCents).toBe(0);
    expect(result.poppynzKeeps.totalCents).toBe(0);
  });

  it('measures early/late from recorded_at: exactly the cutoff is timely, one ms later is late', () => {
    const at = (recordedAt: Date) =>
      money(wed, {
        kind: 'family_cancelled_early',
        status: 'confirmed',
        reportedBySide: 'family',
        recordedAt
      }).outcome;
    expect(at(CUTOFF)).toBe('family_early');
    expect(at(new Date(CUTOFF.getTime() + 1))).toBe('family_late');
    expect(at(new Date(CUTOFF.getTime() - 60_000))).toBe('family_early');
  });

  it('follows the wall clock across the autumn DST night (25 real hours)', () => {
    // Sunday 2026-11-01 9:00 EST; the cutoff is Sat 10-31 9:00 EDT = 13:00Z.
    const sunday: MoneySession = { date: '2026-11-01', startMinutes: 540, elapsedMinutes: 300 };
    const outcome = (recordedAt: string) =>
      money(
        wed,
        {
          kind: 'family_cancelled_early',
          status: 'confirmed',
          reportedBySide: 'family',
          recordedAt: new Date(recordedAt)
        },
        sunday
      ).outcome;
    expect(outcome('2026-10-31T13:00:00.000Z')).toBe('family_early');
    // 24.5 real hours before the start, but after 9:00 the day before.
    expect(outcome('2026-10-31T13:30:00.000Z')).toBe('family_late');
  });

  it('follows the wall clock across the spring DST night (23 real hours)', () => {
    // Sunday 2027-03-14 9:00 EDT = 13:00Z; cutoff Sat 9:00 EST = 14:00Z.
    const sunday: MoneySession = { date: '2027-03-14', startMinutes: 540, elapsedMinutes: 300 };
    const outcome = (recordedAt: string) =>
      money(
        wed,
        {
          kind: 'family_cancelled_late',
          status: 'confirmed',
          reportedBySide: 'family',
          recordedAt: new Date(recordedAt)
        },
        sunday
      ).outcome;
    // 23.5 real hours before the start, yet before 9:00 the day before.
    expect(outcome('2027-03-13T13:30:00.000Z')).toBe('family_early');
    expect(outcome('2027-03-13T14:00:00.001Z')).toBe('family_late');
  });

  it('reduced hours: worked time paid normally, the cancelled remainder under the late rule', () => {
    // 3 of 5 h worked: worked care 37.50, cancelled 25.00 → compensation 6.25.
    const result = money(wed, {
      kind: 'family_reduced_hours',
      status: 'confirmed',
      reportedBySide: 'helper',
      minutesWorked: 180
    });
    expect(result.outcome).toBe('family_late');
    expect(result.helperOwed.compensationCents).toBe(625);
    // Worked: care 3750, its share of the commission (937 × 3/5 = 562.2 → 562)
    // and of its tax (47 × 3/5 = 28.2 → 28).
    expect(result.helperOwed.workedCents).toBe(3750 - 562 - 28);
    // Refund: cancelled care − compensation + the cancelled share of the fee
    // (312 × 2/5 = 124.8 → 125) and its tax (40 × 2/5 = 16).
    expect(result.familyRefund).toMatchObject({ careCents: 2500 - 625, feeCents: 125 });
    expect(result.familyRefund.feeTaxLines[0]!.taxCents).toBe(16);
    expect(result.poppynzKeeps).toMatchObject({
      feeCents: 187,
      feeTaxCents: 24,
      commissionCents: 562,
      commissionTaxCents: 28
    });
    balanced(wed, result);
  });

  it('early dismissal reported by the family with minutes worked is the same partial rule', () => {
    const result = money(wed, {
      kind: 'family_reduced_hours',
      status: 'confirmed',
      reportedBySide: 'family',
      minutesWorked: 0
    });
    // Nothing worked: exactly a late cancellation.
    expect(result.helperOwed.totalCents).toBe(1563);
    expect(result.familyRefund.totalCents).toBe(5039);
  });

  it('helper cancels or does not show: helper $0, full refund, Poppynz $0', () => {
    for (const kind of ['helper_cancelled', 'helper_no_show'] as const) {
      const result = money(wed, { kind, status: 'confirmed', reportedBySide: 'family' });
      expect(result.outcome).toBe('helper_cancelled');
      expect(result.familyRefund.totalCents).toBe(6602);
      expect(result.helperOwed.totalCents).toBe(0);
      expect(result.poppynzKeeps.totalCents).toBe(0);
    }
  });

  it('an agreed day off: the family’s counts as their (timely) cancellation, the helper’s as theirs', () => {
    const family = money(wed, {
      kind: 'day_off_agreed',
      status: 'confirmed',
      reportedBySide: 'family',
      recordedAt: new Date('2026-11-01T12:00:00.000Z')
    });
    expect(family.outcome).toBe('family_early');
    expect(family.familyRefund.totalCents).toBe(6602);
    const helper = money(wed, {
      kind: 'day_off_agreed',
      status: 'confirmed',
      reportedBySide: 'helper',
      recordedAt: new Date('2026-11-01T12:00:00.000Z')
    });
    expect(helper.outcome).toBe('helper_cancelled');
    expect(helper.helperOwed.totalCents).toBe(0);
  });

  it('a proposal not yet confirmed changes nothing; an open report or a dispute holds both sides', () => {
    expect(
      money(wed, { kind: 'day_off_agreed', status: 'proposed', reportedBySide: 'family' }).outcome
    ).toBe('none');
    for (const overrides of [
      { kind: 'helper_no_show' as const, status: 'proposed' as const },
      { kind: 'family_cancelled_late' as const, status: 'contested' as const },
      { kind: 'disputed' as const, status: 'contested' as const }
    ]) {
      const result = money(wed, overrides);
      expect(result).toMatchObject({ outcome: 'held', held: true });
      expect(result.familyRefund.totalCents).toBe(0);
      expect(result.helperOwed.totalCents).toBe(0);
      expect(result.heldCents).toEqual({ family: 6602, helper: wed.helperShareCents });
    }
  });

  it('lapsed or reversed resolutions are history: nothing applies', () => {
    for (const status of ['lapsed', 'reversed'] as const) {
      expect(money(wed, { kind: 'helper_cancelled', status }).outcome).toBe('none');
    }
  });

  it('an admin decision replaces the reported kind (as scheduled, or with minutes)', () => {
    expect(
      money(wed, { kind: 'disputed', status: 'decided', decision: 'as_scheduled' }).outcome
    ).toBe('none');
    const partial = money(wed, {
      kind: 'helper_no_show',
      status: 'decided',
      decision: 'family_reduced_hours',
      decisionMinutesWorked: 180
    });
    expect(partial.helperOwed.compensationCents).toBe(625);
    // The admin decided "late" — not re-derived from recorded_at.
    expect(
      money(wed, {
        kind: 'family_cancelled_early',
        status: 'decided',
        decision: 'family_cancelled_late',
        recordedAt: new Date('2026-10-01T00:00:00Z')
      }).outcome
    ).toBe('family_late');
  });

  it('a session charged compensation only (cancelled late before the capture) keeps it for the helper', () => {
    const compensation: SessionChargeSplit = {
      ...mon,
      basis: 'compensation',
      careCents: 1563,
      careTaxLines: [],
      careTaxCents: 0,
      familyFeeCents: 0,
      familyFeeTaxLines: [],
      familyFeeTaxCents: 0,
      familyTotalCents: 1563,
      commissionCents: 0,
      commissionTaxLines: [],
      commissionTaxCents: 0,
      helperShareCents: 1563
    };
    const late = money(compensation, {
      kind: 'family_cancelled_late',
      status: 'confirmed',
      reportedBySide: 'family',
      recordedAt: new Date('2026-11-04T08:00:00.000Z')
    });
    expect(late.familyRefund.totalCents).toBe(0);
    expect(late.helperOwed.totalCents).toBe(1563);
    // Decided as the helper's cancellation after all: the compensation goes back.
    const helper = money(compensation, {
      kind: 'helper_cancelled',
      status: 'decided',
      decision: 'helper_cancelled'
    });
    expect(helper.familyRefund.totalCents).toBe(1563);
    expect(helper.helperOwed.totalCents).toBe(0);
  });

  it('applies the configured compensation share', () => {
    const result = resolveSessionMoney(
      wed,
      {
        resolution: dummySessionResolution({ kind: 'family_no_show', status: 'confirmed' }),
        session: wedSession,
        zone: ZONE
      },
      { ...policy, lateCancellationHelperBps: 5000 }
    );
    expect(result.helperOwed.compensationCents).toBe(3125);
  });
});

describe('effectiveSessionOutcome', () => {
  it('maps every kind', () => {
    const outcome = (overrides: Parameters<typeof dummySessionResolution>[0]) =>
      effectiveSessionOutcome(
        { resolution: dummySessionResolution(overrides), session: wedSession, zone: ZONE },
        policy
      );
    expect(outcome({ kind: 'family_no_show', status: 'confirmed' })).toEqual({
      kind: 'family_late',
      minutesWorked: 0
    });
    expect(
      outcome({ kind: 'family_reduced_hours', status: 'confirmed', minutesWorked: 999 })
    ).toEqual({
      kind: 'family_late',
      minutesWorked: 300
    });
    expect(outcome({ kind: 'helper_no_show', status: 'confirmed' })).toEqual({
      kind: 'helper_cancelled'
    });
  });
});
