import { describe, expect, it } from 'bun:test';
import { allocateLargestRemainder, splitCycleCharge, type SplitInput, type SplitTaxLine } from './split';
import { quoteContractAmounts, type ProvinceCode } from './index';
import { seededSnapshot } from './test-snapshot';

const snapshot = seededSnapshot();

/** The cycle's charged components, quoted exactly as billing quotes them. */
const quoted = (
  sessions: SplitInput['sessions'],
  options: {
    carriedInCents?: number;
    family?: ProvinceCode;
    helper?: ProvinceCode;
    feeBps?: number;
    commissionBps?: number;
    compensationCents?: number;
  } = {}
): SplitInput => {
  const carriedInCents = options.carriedInCents ?? 0;
  const service =
    sessions.filter((s) => (s.compensationCents ?? 0) === 0).reduce((t, s) => t + s.valueCents, 0) +
    carriedInCents;
  const result = quoteContractAmounts({
    serviceCents: service,
    familyFeeBps: options.feeBps ?? 500,
    providerCommissionBps: options.commissionBps ?? 1500,
    snapshot,
    on: '2026-11-02',
    familyProvince: options.family ?? 'ON',
    helperProvince: options.helper ?? 'MB'
  });
  if (!result.ok) throw new Error('quote failed');
  const a = result.amounts;
  return {
    sessions,
    carriedInCents,
    serviceTaxLines: a.serviceTaxLines,
    familyFeeCents: a.familyFeeCents,
    familyFeeTaxLines: a.familyFeeTaxLines,
    providerCommissionCents: a.providerCommissionCents,
    providerCommissionTaxLines: a.providerCommissionTaxLines,
    compensationTaxLines: []
  };
};

const sumTax = (lines: ReadonlyArray<SplitTaxLine>) => lines.reduce((t, l) => t + l.taxCents, 0);

describe('allocateLargestRemainder', () => {
  it('floors each exact share and gives the leftover cents to the largest remainders', () => {
    // 100 over 1:1:1 → 33.33 each → 33, 33, 33 and one cent to the first (tie).
    expect(allocateLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
    // 10 over 1:2:3 → 1.67, 3.33, 5 → 1, 3, 5; leftover 1 → largest remainder (0.67).
    expect(allocateLargestRemainder(10, [1, 2, 3])).toEqual([2, 3, 5]);
  });

  it('breaks ties toward the earlier participant, deterministically', () => {
    expect(allocateLargestRemainder(1, [5, 5])).toEqual([1, 0]);
    expect(allocateLargestRemainder(3, [2, 2, 2, 2])).toEqual([1, 1, 1, 0]);
    // Re-running gives the same cents.
    expect(allocateLargestRemainder(7, [3, 1, 3, 1])).toEqual(
      allocateLargestRemainder(7, [3, 1, 3, 1])
    );
  });

  it('allocates nothing over zero weights', () => {
    expect(allocateLargestRemainder(0, [0, 0])).toEqual([0, 0]);
    expect(() => allocateLargestRemainder(5, [0, 0])).toThrow();
  });
});

describe('splitCycleCharge — the §5 worked example', () => {
  it('splits two $62.50 sessions (ON family, MB helper) exactly as the spec table', () => {
    const split = splitCycleCharge(
      quoted([
        { sessionId: 'wed', startsAt: new Date('2026-11-04T14:00:00Z'), slot: 'a@600', valueCents: 6250 },
        { sessionId: 'mon', startsAt: new Date('2026-11-02T14:00:00Z'), slot: 'a@600', valueCents: 6250 }
      ])
    );
    const [mon, wed] = split.sessions;
    expect(mon).toMatchObject({
      sessionId: 'mon',
      basis: 'session',
      careCents: 6250,
      familyFeeCents: 313,
      familyFeeTaxCents: 41,
      familyTotalCents: 6604,
      commissionCents: 938,
      commissionTaxCents: 47,
      helperShareCents: 5265
    });
    expect(wed).toMatchObject({
      sessionId: 'wed',
      careCents: 6250,
      familyFeeCents: 312,
      familyFeeTaxCents: 40,
      familyTotalCents: 6602,
      commissionCents: 937,
      commissionTaxCents: 47,
      helperShareCents: 5266
    });
    expect(mon!.familyFeeTaxLines[0]).toMatchObject({ label: 'HST (ON) 13%', taxCents: 41, baseCents: 313 });
    expect(mon!.commissionTaxLines[0]).toMatchObject({ label: 'GST (MB) 5%', taxCents: 47 });
    expect(split.carry).toBeNull();
    expect(mon!.familyTotalCents + wed!.familyTotalCents).toBe(13206);
    expect(mon!.helperShareCents + wed!.helperShareCents).toBe(10531);
  });

  it('ties go to the earlier session by start time, then slot', () => {
    const at = new Date('2026-11-02T14:00:00Z');
    const split = splitCycleCharge(
      quoted([
        { sessionId: 'b', startsAt: at, slot: 'svc-b@600', valueCents: 6250 },
        { sessionId: 'a', startsAt: at, slot: 'svc-a@600', valueCents: 6250 }
      ])
    );
    expect(split.sessions.map((s) => [s.sessionId, s.familyFeeCents])).toEqual([
      ['a', 313],
      ['b', 312]
    ]);
  });
});

describe('splitCycleCharge — properties', () => {
  // A small deterministic PRNG, so a failure is reproducible.
  const prng = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const provinces: Array<ProvinceCode> = ['ON', 'QC', 'MB', 'BC', 'NS', 'AB', 'NB'];

  it('is exact for every component over many random cycles (carries and reduced captures)', () => {
    const random = prng(20261028);
    for (let run = 0; run < 2000; run += 1) {
      const count = 1 + Math.floor(random() * 6);
      const all = Array.from({ length: count }, (_, i) => ({
        sessionId: `s${i}`,
        startsAt: new Date(Date.UTC(2026, 10, 2 + Math.floor(random() * 3), 8 + Math.floor(random() * 10))),
        slot: `svc${Math.floor(random() * 3)}@${i}`,
        valueCents: 1 + Math.floor(random() * 40_000)
      }));
      // A reduced capture: some sessions dropped before the charge; the
      // split is made from what was captured (the re-quote of the rest).
      const kept = all.filter((_, i) => i === 0 || random() > 0.3);
      const carriedInCents = random() < 0.3 ? Math.floor(random() * 49) + 1 : 0;
      const input = quoted(kept, {
        carriedInCents,
        family: provinces[Math.floor(random() * provinces.length)],
        helper: provinces[Math.floor(random() * provinces.length)],
        feeBps: Math.floor(random() * 1000),
        commissionBps: Math.floor(random() * 3000)
      });
      const split = splitCycleCharge(input);
      const rows = [...split.sessions, ...(split.carry ? [split.carry] : [])];
      const total = (pick: (row: (typeof rows)[number]) => number) =>
        rows.reduce((t, row) => t + pick(row), 0);
      expect(total((r) => r.careCents)).toBe(
        kept.reduce((t, s) => t + s.valueCents, 0) + carriedInCents
      );
      expect(total((r) => r.familyFeeCents)).toBe(input.familyFeeCents);
      expect(total((r) => r.familyFeeTaxCents)).toBe(sumTax(input.familyFeeTaxLines));
      expect(total((r) => r.careTaxCents)).toBe(sumTax(input.serviceTaxLines));
      expect(total((r) => r.commissionCents)).toBe(input.providerCommissionCents);
      expect(total((r) => r.commissionTaxCents)).toBe(sumTax(input.providerCommissionTaxLines));
      // Every tax line, line by line (jurisdiction, component, rate kept).
      input.familyFeeTaxLines.forEach((line, index) => {
        expect(total((r) => r.familyFeeTaxLines[index]!.taxCents)).toBe(line.taxCents);
        expect(total((r) => r.familyFeeTaxLines[index]!.baseCents)).toBe(line.baseCents);
        for (const row of rows) {
          expect(row.familyFeeTaxLines[index]!.label).toBe(line.label);
          expect(row.familyFeeTaxLines[index]!.rateMillipercent).toBe(line.rateMillipercent);
        }
      });
      input.providerCommissionTaxLines.forEach((line, index) => {
        expect(total((r) => r.commissionTaxLines[index]!.taxCents)).toBe(line.taxCents);
      });
      const familyTotal =
        input.familyFeeCents +
        sumTax(input.familyFeeTaxLines) +
        sumTax(input.serviceTaxLines) +
        kept.reduce((t, s) => t + s.valueCents, 0) +
        carriedInCents;
      expect(total((r) => r.familyTotalCents)).toBe(familyTotal);
      for (const row of rows) {
        expect(row.familyTotalCents).toBe(
          row.careCents + row.careTaxCents + row.familyFeeCents + row.familyFeeTaxCents
        );
        expect(row.helperShareCents).toBe(
          row.careCents + row.careTaxCents - row.commissionCents - row.commissionTaxCents
        );
      }
      // Stable: the same input gives the same cents.
      expect(splitCycleCharge(input)).toEqual(split);
    }
  });

  it('keeps a carried-in amount as its own line, never allocated to a session', () => {
    const split = splitCycleCharge(
      quoted(
        [{ sessionId: 's', startsAt: new Date('2026-11-02T14:00:00Z'), slot: 'a@1', valueCents: 5000 }],
        { carriedInCents: 40 }
      )
    );
    expect(split.sessions[0]!.careCents).toBe(5000);
    expect(split.carry).toMatchObject({ careCents: 40 });
    expect(split.sessions[0]!.familyFeeCents + split.carry!.familyFeeCents).toBe(252);
  });

  it('charges a pre-capture late cancellation as compensation only (no fee, no commission)', () => {
    const sessions = [
      { sessionId: 'kept', startsAt: new Date('2026-11-02T14:00:00Z'), slot: 'a@1', valueCents: 6250 },
      {
        sessionId: 'late',
        startsAt: new Date('2026-11-03T14:00:00Z'),
        slot: 'a@1',
        valueCents: 6250,
        compensationCents: 1563
      }
    ];
    const split = splitCycleCharge(quoted(sessions));
    const late = split.sessions.find((s) => s.sessionId === 'late')!;
    expect(late).toMatchObject({
      basis: 'compensation',
      careCents: 1563,
      familyFeeCents: 0,
      familyFeeTaxCents: 0,
      commissionCents: 0,
      familyTotalCents: 1563,
      helperShareCents: 1563
    });
    const kept = split.sessions.find((s) => s.sessionId === 'kept')!;
    expect(kept).toMatchObject({ familyFeeCents: 313, familyTotalCents: 6604 });
  });
});
