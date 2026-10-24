import {
  taxConfigAudit,
  taxJurisdiction,
  taxRate,
  taxRegistration,
  taxSupplyTreatment,
  taxSupplyType
} from '@repo/db/schema';
import type { Seed } from '../types';

// Default sales-tax configuration (piece 3 spec §3a; user decisions of
// 2026-10-24). These are STARTING FIGURES for the accountant to review and
// correct through the tax configuration — never edit them in code once this
// seed has run. Rates are thousandths of a percent (5% = 5000).
//
// - GST/HST applies to Poppynz's own supplies (the family service fee, the
//   helper commission, the background check and its admin fee). QST is listed
//   on those supplies but Poppynz is NOT registered for it, so it isn't
//   charged until the registration is switched on.
// - PST (BC, SK) and RST (MB) are seeded as rates only: no treatment lists
//   them, so they are never applied.
// - The care service value (the helper's own supply) is exempt; cancellation
//   compensation is out of scope.

const jurisdictions = [
  { code: 'CA', name: 'Canada (federal)', kind: 'federal' },
  { code: 'AB', name: 'Alberta', kind: 'province' },
  { code: 'BC', name: 'British Columbia', kind: 'province' },
  { code: 'MB', name: 'Manitoba', kind: 'province' },
  { code: 'NB', name: 'New Brunswick', kind: 'province' },
  { code: 'NL', name: 'Newfoundland and Labrador', kind: 'province' },
  { code: 'NS', name: 'Nova Scotia', kind: 'province' },
  { code: 'ON', name: 'Ontario', kind: 'province' },
  { code: 'PE', name: 'Prince Edward Island', kind: 'province' },
  { code: 'QC', name: 'Quebec', kind: 'province' },
  { code: 'SK', name: 'Saskatchewan', kind: 'province' },
  { code: 'NT', name: 'Northwest Territories', kind: 'territory' },
  { code: 'NU', name: 'Nunavut', kind: 'territory' },
  { code: 'YT', name: 'Yukon', kind: 'territory' }
] as const;

type Component = 'gst' | 'hst' | 'pst' | 'qst' | 'rst';
const rate = (
  jurisdictionCode: string,
  component: Component,
  rateMillipercent: number,
  effectiveFrom: string,
  effectiveTo: string | null = null
) => ({ jurisdictionCode, component, rateMillipercent, effectiveFrom, effectiveTo });

export const defaultTaxRates = [
  ...['AB', 'BC', 'MB', 'SK', 'QC', 'NT', 'NU', 'YT'].map((code) =>
    rate(code, 'gst', 5000, '2008-01-01')
  ),
  rate('ON', 'hst', 13000, '2010-07-01'),
  rate('NB', 'hst', 15000, '2016-07-01'),
  rate('NL', 'hst', 15000, '2016-07-01'),
  rate('PE', 'hst', 15000, '2016-10-01'),
  rate('NS', 'hst', 15000, '2010-07-01', '2025-04-01'),
  rate('NS', 'hst', 14000, '2025-04-01'),
  rate('QC', 'qst', 9975, '2013-01-01'),
  rate('BC', 'pst', 7000, '2013-04-01'),
  rate('SK', 'pst', 6000, '2017-03-23'),
  rate('MB', 'rst', 7000, '2019-07-01')
];

const supplyTypes = [
  { code: 'family_service_fee', name: 'Family service fee' },
  { code: 'provider_commission', name: 'Helper commission' },
  { code: 'credibled_check', name: 'Background check' },
  { code: 'credibled_admin_fee', name: 'Background check administration fee' },
  { code: 'care_service_value', name: 'Care service (hours × rate)' },
  { code: 'cancellation_compensation', name: 'Cancellation compensation' }
];

const salesTax: Array<Component> = ['gst', 'hst', 'qst'];
const since = '2008-01-01';

export const defaultTaxTreatments = [
  {
    supplyTypeCode: 'family_service_fee',
    treatment: 'taxable',
    components: salesTax,
    placeOfSupply: 'contract_location'
  },
  {
    supplyTypeCode: 'provider_commission',
    treatment: 'taxable',
    components: salesTax,
    placeOfSupply: 'helper_province'
  },
  {
    supplyTypeCode: 'credibled_check',
    treatment: 'taxable',
    components: salesTax,
    placeOfSupply: 'payer_province'
  },
  {
    supplyTypeCode: 'credibled_admin_fee',
    treatment: 'taxable',
    components: salesTax,
    placeOfSupply: 'payer_province'
  },
  {
    supplyTypeCode: 'care_service_value',
    treatment: 'exempt',
    components: [],
    placeOfSupply: 'contract_location'
  },
  {
    supplyTypeCode: 'cancellation_compensation',
    treatment: 'out_of_scope',
    components: [],
    placeOfSupply: 'contract_location'
  }
].map((row) => ({ ...row, effectiveFrom: since, effectiveTo: null })) as Array<
  typeof taxSupplyTreatment.$inferInsert
>;

export const defaultTaxRegistrations = [
  {
    jurisdictionCode: 'CA',
    program: 'gst_hst',
    components: ['gst', 'hst'] as Array<Component>,
    // PLACEHOLDER — replace with Poppynz's real business number.
    registrationNumber: 'PLACEHOLDER-000000000RT0001',
    registered: true,
    isPlaceholder: true,
    effectiveFrom: since,
    effectiveTo: null
  },
  {
    jurisdictionCode: 'QC',
    program: 'qst',
    components: ['qst'] as Array<Component>,
    registrationNumber: null,
    registered: false,
    isPlaceholder: true,
    effectiveFrom: since,
    effectiveTo: null
  }
];

const reason = 'seed 0004_tax_config: default configuration';

export const taxConfig: Seed = {
  name: '0004_tax_config',
  run: async (db) => {
    await db.insert(taxJurisdiction).values([...jurisdictions]);
    await db.insert(taxSupplyType).values(supplyTypes);
    const rates = await db.insert(taxRate).values(defaultTaxRates).returning();
    const treatments = await db.insert(taxSupplyTreatment).values(defaultTaxTreatments).returning();
    const registrations = await db
      .insert(taxRegistration)
      .values(defaultTaxRegistrations)
      .returning();
    // The configuration's history starts here, like every later change.
    const audit = [
      ...rates.map((row) => ({ entity: 'tax_rate', recordId: row.id, after: row })),
      ...treatments.map((row) => ({
        entity: 'tax_supply_treatment',
        recordId: row.id,
        after: row
      })),
      ...registrations.map((row) => ({ entity: 'tax_registration', recordId: row.id, after: row }))
    ];
    await db.insert(taxConfigAudit).values(
      audit.map((entry) => ({
        ...entry,
        action: 'create' as const,
        actorUserId: null,
        reason,
        before: null,
        after: JSON.parse(JSON.stringify(entry.after))
      }))
    );
  }
};
