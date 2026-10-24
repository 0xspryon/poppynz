import { describe, expect, it } from 'bun:test';
import {
  dummyTaxRate,
  dummyTaxRegistration,
  dummyTaxSupplyTreatment,
  makeInMemoryTaxConfigRepo
} from '@repo/db';
import { Effect } from 'effect';
import { computeSupplyTax } from './pricing';
import { loadTaxSnapshot, toTaxQuoteError } from './tax';

describe('loadTaxSnapshot', () => {
  it('reads the database configuration the resolver applies', async () => {
    const { layer } = makeInMemoryTaxConfigRepo({
      rates: [dummyTaxRate()],
      treatments: [dummyTaxSupplyTreatment()],
      registrations: [dummyTaxRegistration()]
    });
    const snapshot = await Effect.runPromise(loadTaxSnapshot.pipe(Effect.provide(layer)));
    const result = computeSupplyTax({
      snapshot,
      supplyType: 'family_service_fee',
      baseCents: 3000,
      on: '2026-11-02',
      provinces: { contract: 'ON' }
    });
    expect(result.ok && result.lines.map((line) => [line.label, line.taxCents])).toEqual([
      ['HST (ON) 13%', 390]
    ]);
  });

  it('charges nothing while Poppynz holds no registration', async () => {
    const { layer } = makeInMemoryTaxConfigRepo({
      rates: [dummyTaxRate()],
      treatments: [dummyTaxSupplyTreatment()],
      registrations: [dummyTaxRegistration({ registered: false })]
    });
    const snapshot = await Effect.runPromise(loadTaxSnapshot.pipe(Effect.provide(layer)));
    expect(
      computeSupplyTax({
        snapshot,
        supplyType: 'family_service_fee',
        baseCents: 3000,
        on: '2026-11-02',
        provinces: { contract: 'ON' }
      })
    ).toEqual({ ok: true, lines: [], taxCents: 0 });
  });
});

describe('toTaxQuoteError', () => {
  it('names whose province is missing', () => {
    expect(
      toTaxQuoteError({
        reason: 'province_required',
        supplyType: 'provider_commission',
        placeOfSupply: 'helper_province'
      })
    ).toMatchObject({ _tag: 'TaxProvinceRequiredError', party: 'helper' });
    expect(
      toTaxQuoteError({ reason: 'rate_missing', supplyType: 'family_service_fee', province: 'AB' })
    ).toMatchObject({ _tag: 'TaxRateMissingError' });
  });
});
