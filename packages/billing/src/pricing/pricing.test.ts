import { describe, expect, it } from 'bun:test';
import {
  applyBps,
  computeSupplyTax,
  formatRate,
  normaliseProvince,
  quoteCheckTax,
  quoteContractAmounts,
  roundHalfUp,
  sessionValueCents,
  weeklyServiceCents,
  type ProvinceCode,
  type TaxSnapshot
} from './index';
import { seededSnapshot } from './test-snapshot';

const ON = '2026-11-02';

const feeTax = (
  province: ProvinceCode | null,
  baseCents: number,
  on = ON,
  snapshot = seededSnapshot()
) =>
  computeSupplyTax({
    snapshot,
    supplyType: 'family_service_fee',
    baseCents,
    on,
    provinces: { contract: province, payer: province }
  });

describe('roundHalfUp', () => {
  it('rounds halves up and everything else to the nearest cent', () => {
    expect(roundHalfUp(5, 10)).toBe(1);
    expect(roundHalfUp(4, 10)).toBe(0);
    expect(roundHalfUp(15, 10)).toBe(2);
    expect(roundHalfUp(14999, 10000)).toBe(1);
    expect(roundHalfUp(0, 7)).toBe(0);
  });

  it('refuses non-integers and negative amounts', () => {
    expect(() => roundHalfUp(1.5, 2)).toThrow();
    expect(() => roundHalfUp(-1, 2)).toThrow();
    expect(() => roundHalfUp(1, 0)).toThrow();
  });

  it('values sessions and fees with the same rule', () => {
    expect(sessionValueCents(2500, 90)).toBe(3750);
    expect(sessionValueCents(1999, 50)).toBe(1666); // 1665.83…
    expect(applyBps(60000, 500)).toBe(3000);
    expect(applyBps(1010, 500)).toBe(51); // 50.5 → 51
  });
});

describe('normaliseProvince', () => {
  it('accepts codes and names in any case', () => {
    expect(normaliseProvince('ON')).toBe('ON');
    expect(normaliseProvince(' ontario ')).toBe('ON');
    expect(normaliseProvince('Québec', 'Canada')).toBe('QC');
    expect(normaliseProvince('British  Columbia', 'CA')).toBe('BC');
  });

  it('is null for another country, an unknown value or nothing', () => {
    expect(normaliseProvince('ON', 'US')).toBeNull();
    expect(normaliseProvince('Bavaria')).toBeNull();
    expect(normaliseProvince(null)).toBeNull();
  });
});

describe('computeSupplyTax with the seeded configuration', () => {
  const expected: Record<ProvinceCode, Array<[string, number]>> = {
    AB: [['GST (AB) 5%', 25]],
    BC: [['GST (BC) 5%', 25]],
    MB: [['GST (MB) 5%', 25]],
    SK: [['GST (SK) 5%', 25]],
    QC: [['GST (QC) 5%', 25]],
    NT: [['GST (NT) 5%', 25]],
    NU: [['GST (NU) 5%', 25]],
    YT: [['GST (YT) 5%', 25]],
    ON: [['HST (ON) 13%', 65]],
    NB: [['HST (NB) 15%', 75]],
    NL: [['HST (NL) 15%', 75]],
    PE: [['HST (PE) 15%', 75]],
    NS: [['HST (NS) 14%', 70]]
  };

  for (const [province, lines] of Object.entries(expected)) {
    it(`taxes a $5.00 fee in ${province}`, () => {
      const result = feeTax(province as ProvinceCode, 500);
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(result.lines.map((line) => [line.label, line.taxCents])).toEqual(lines);
      expect(result.taxCents).toBe(lines[0]![1]);
    });
  }

  it('applies the NS rate in force on the supply date', () => {
    const before = feeTax('NS', 10000, '2025-03-31');
    const after = feeTax('NS', 10000, '2025-04-01');
    expect(before.ok && before.lines[0]?.label).toBe('HST (NS) 15%');
    expect(after.ok && after.lines[0]?.label).toBe('HST (NS) 14%');
  });

  it('charges QST only once Poppynz is registered for it', () => {
    const unregistered = feeTax('QC', 10000);
    expect(unregistered.ok && unregistered.lines.map((line) => line.label)).toEqual([
      'GST (QC) 5%'
    ]);
    const registered = feeTax('QC', 10000, ON, seededSnapshot({ qstRegistered: true }));
    expect(registered.ok && registered.lines.map((line) => [line.label, line.taxCents])).toEqual([
      ['GST (QC) 5%', 500],
      ['QST (QC) 9.975%', 998]
    ]);
  });

  it('never applies the seeded PST or RST rates', () => {
    for (const province of ['BC', 'SK', 'MB'] as const) {
      const result = feeTax(province, 10000);
      expect(result.ok && result.lines.map((line) => line.component)).toEqual(['gst']);
    }
  });

  it('freezes everything a receipt needs on the line', () => {
    const result = feeTax('ON', 3000);
    expect(result.ok && result.lines[0]).toEqual({
      supplyType: 'family_service_fee',
      jurisdiction: 'ON',
      component: 'hst',
      rateMillipercent: 13000,
      baseCents: 3000,
      taxCents: 390,
      label: 'HST (ON) 13%',
      registrationNumber: 'PLACEHOLDER-000000000RT0001'
    });
  });

  it('adds nothing for exempt and out-of-scope supplies', () => {
    for (const supplyType of ['care_service_value', 'cancellation_compensation'] as const) {
      const result = computeSupplyTax({
        snapshot: seededSnapshot(),
        supplyType,
        baseCents: 10000,
        on: ON,
        provinces: {}
      });
      expect(result).toEqual({ ok: true, lines: [], taxCents: 0 });
    }
  });

  it('refuses an unknown province instead of charging 0', () => {
    expect(feeTax(null, 500)).toEqual({
      ok: false,
      error: {
        reason: 'province_required',
        supplyType: 'family_service_fee',
        placeOfSupply: 'contract_location'
      }
    });
  });

  it('refuses a taxable supply with no rate in force', () => {
    const snapshot: TaxSnapshot = {
      ...seededSnapshot(),
      rates: seededSnapshot().rates.filter((row) => row.jurisdictionCode !== 'AB')
    };
    expect(feeTax('AB', 500, ON, snapshot)).toEqual({
      ok: false,
      error: { reason: 'rate_missing', supplyType: 'family_service_fee', province: 'AB' }
    });
  });

  it('refuses a supply type with no treatment in force', () => {
    const snapshot: TaxSnapshot = { ...seededSnapshot(), treatments: [] };
    expect(feeTax('ON', 500, ON, snapshot)).toEqual({
      ok: false,
      error: { reason: 'treatment_missing', supplyType: 'family_service_fee' }
    });
  });

  it('needs no province for a zero base', () => {
    expect(feeTax(null, 0)).toEqual({ ok: true, lines: [], taxCents: 0 });
  });

  it('formats rates with up to three decimals', () => {
    expect(formatRate(13000)).toBe('13');
    expect(formatRate(9975)).toBe('9.975');
    expect(formatRate(7500)).toBe('7.5');
  });
});

describe('quoteContractAmounts', () => {
  it('reproduces the umbrella example with tax by each side’s province', () => {
    const result = quoteContractAmounts({
      serviceCents: 60000,
      familyFeeBps: 500,
      providerCommissionBps: 1500,
      snapshot: seededSnapshot(),
      on: ON,
      familyProvince: 'ON',
      helperProvince: 'MB'
    });
    if (!result.ok) throw new Error('quote failed');
    const amounts = result.amounts;
    expect(amounts.familyFeeCents).toBe(3000);
    expect(amounts.familyFeeTaxLines.map((line) => [line.label, line.taxCents])).toEqual([
      ['HST (ON) 13%', 390]
    ]);
    expect(amounts.familyTotalCents).toBe(63390);
    expect(amounts.providerCommissionCents).toBe(9000);
    expect(amounts.providerCommissionTaxLines.map((line) => [line.label, line.taxCents])).toEqual([
      ['GST (MB) 5%', 450]
    ]);
    expect(amounts.providerShareCents).toBe(50550);
    expect(amounts.serviceTaxLines).toEqual([]);
  });

  it('refuses when the helper’s province is unknown', () => {
    const result = quoteContractAmounts({
      serviceCents: 60000,
      familyFeeBps: 500,
      providerCommissionBps: 1500,
      snapshot: seededSnapshot(),
      on: ON,
      familyProvince: 'ON',
      helperProvince: null
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.reason).toBe('province_required');
  });
});

describe('weeklyServiceCents', () => {
  it('values each session with the shared rule', () => {
    expect(
      weeklyServiceCents([
        {
          rateCents: 1999,
          sessions: [
            { startMinutes: 600, endMinutes: 650 },
            { startMinutes: 600, endMinutes: 650 }
          ]
        }
      ])
    ).toBe(3332);
  });
});

describe('quoteCheckTax', () => {
  it('taxes the checks and the administration fee at the payer’s province', () => {
    const result = quoteCheckTax({
      snapshot: seededSnapshot(),
      on: ON,
      payerProvince: 'ON',
      checksCents: 5500,
      adminFeeCents: 500
    });
    expect(
      result.ok && result.lines.map((line) => [line.supplyType, line.label, line.taxCents])
    ).toEqual([
      ['credibled_check', 'HST (ON) 13%', 715],
      ['credibled_admin_fee', 'HST (ON) 13%', 65]
    ]);
    expect(result.ok && result.taxCents).toBe(780);
  });

  it('refuses without a province', () => {
    const result = quoteCheckTax({
      snapshot: seededSnapshot(),
      on: ON,
      payerProvince: null,
      checksCents: 5500,
      adminFeeCents: 500
    });
    expect(!result.ok && result.error.reason).toBe('province_required');
  });
});
