import type { TaxComponent, TaxSnapshot } from './tax';

/** TEST DATA ONLY: mirrors the seeded defaults (packages/seeder seed
 * `0004_tax_config`). Runtime code always reads the database. */
const gst = (code: string) => ({
  jurisdictionCode: code,
  component: 'gst' as const,
  rateMillipercent: 5000,
  effectiveFrom: '2008-01-01',
  effectiveTo: null
});
const hst = (code: string, rate: number, from: string, to: string | null = null) => ({
  jurisdictionCode: code,
  component: 'hst' as const,
  rateMillipercent: rate,
  effectiveFrom: from,
  effectiveTo: to
});
const taxable = ['gst', 'hst', 'qst'] as Array<TaxComponent>;

export const seededSnapshot = (options: { qstRegistered?: boolean } = {}): TaxSnapshot => ({
  rates: [
    ...['AB', 'BC', 'MB', 'SK', 'QC', 'NT', 'NU', 'YT'].map(gst),
    hst('ON', 13000, '2010-07-01'),
    hst('NB', 15000, '2016-07-01'),
    hst('NL', 15000, '2016-07-01'),
    hst('PE', 15000, '2016-10-01'),
    hst('NS', 15000, '2010-07-01', '2025-04-01'),
    hst('NS', 14000, '2025-04-01'),
    {
      jurisdictionCode: 'QC',
      component: 'qst',
      rateMillipercent: 9975,
      effectiveFrom: '2013-01-01',
      effectiveTo: null
    },
    {
      jurisdictionCode: 'BC',
      component: 'pst',
      rateMillipercent: 7000,
      effectiveFrom: '2013-04-01',
      effectiveTo: null
    },
    {
      jurisdictionCode: 'SK',
      component: 'pst',
      rateMillipercent: 6000,
      effectiveFrom: '2017-03-23',
      effectiveTo: null
    },
    {
      jurisdictionCode: 'MB',
      component: 'rst',
      rateMillipercent: 7000,
      effectiveFrom: '2019-07-01',
      effectiveTo: null
    }
  ],
  treatments: [
    {
      supplyTypeCode: 'family_service_fee',
      treatment: 'taxable',
      components: taxable,
      placeOfSupply: 'contract_location',
      effectiveFrom: '2008-01-01',
      effectiveTo: null
    },
    {
      supplyTypeCode: 'provider_commission',
      treatment: 'taxable',
      components: taxable,
      placeOfSupply: 'helper_province',
      effectiveFrom: '2008-01-01',
      effectiveTo: null
    },
    {
      supplyTypeCode: 'credibled_check',
      treatment: 'taxable',
      components: taxable,
      placeOfSupply: 'payer_province',
      effectiveFrom: '2008-01-01',
      effectiveTo: null
    },
    {
      supplyTypeCode: 'credibled_admin_fee',
      treatment: 'taxable',
      components: taxable,
      placeOfSupply: 'payer_province',
      effectiveFrom: '2008-01-01',
      effectiveTo: null
    },
    {
      supplyTypeCode: 'care_service_value',
      treatment: 'exempt',
      components: [],
      placeOfSupply: 'contract_location',
      effectiveFrom: '2008-01-01',
      effectiveTo: null
    },
    {
      supplyTypeCode: 'cancellation_compensation',
      treatment: 'out_of_scope',
      components: [],
      placeOfSupply: 'contract_location',
      effectiveFrom: '2008-01-01',
      effectiveTo: null
    }
  ],
  registrations: [
    {
      jurisdictionCode: 'CA',
      program: 'gst_hst',
      components: ['gst', 'hst'],
      registrationNumber: 'PLACEHOLDER-000000000RT0001',
      registered: true,
      isPlaceholder: true,
      effectiveFrom: '2008-01-01',
      effectiveTo: null
    },
    {
      jurisdictionCode: 'QC',
      program: 'qst',
      components: ['qst'],
      registrationNumber: null,
      registered: options.qstRegistered ?? false,
      isPlaceholder: true,
      effectiveFrom: '2008-01-01',
      effectiveTo: null
    }
  ]
});
