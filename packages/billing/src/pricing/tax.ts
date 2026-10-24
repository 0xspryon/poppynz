import { roundHalfUp } from './rounding';

/**
 * Sales-tax resolution. Pure and browser-safe: the configuration is DATA (the
 * `tax_*` tables, seeded with defaults and corrected by an accountant), handed
 * in as a snapshot. This file holds only the algorithm:
 *
 *   1. the supply type's treatment in force — none is an error;
 *      anything but `taxable` produces no line;
 *   2. the place of supply picks the province — unknown is an error;
 *   3. each listed component counts only while Poppynz holds a registration
 *      in force that covers it, and then only where the province has a rate
 *      for it in force;
 *   4. a taxable supply with a registered component but no rate at all is an
 *      error. Never a silent 0.
 */

/** A calendar date, `YYYY-MM-DD`. */
type IsoDate = string;

export const TAX_COMPONENTS = ['gst', 'hst', 'pst', 'qst', 'rst'] as const;
export type TaxComponent = (typeof TAX_COMPONENTS)[number];

export const SUPPLY_TYPES = [
  'family_service_fee',
  'provider_commission',
  'credibled_check',
  'credibled_admin_fee',
  'care_service_value',
  'cancellation_compensation'
] as const;
export type SupplyType = (typeof SUPPLY_TYPES)[number];

export const TAX_TREATMENTS = ['taxable', 'exempt', 'zero_rated', 'out_of_scope'] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

export const PLACES_OF_SUPPLY = ['payer_province', 'helper_province', 'contract_location'] as const;
export type PlaceOfSupply = (typeof PLACES_OF_SUPPLY)[number];

export const PROVINCES = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon'
} as const;
export type ProvinceCode = keyof typeof PROVINCES;

/** Rates are thousandths of a percent (basis points × 10): 5% = 5000,
 * 13% = 13000, 9.975% = 9975. */
export const MILLIPERCENT_DENOMINATOR = 100_000;

/** Effective-dated rows are `[effectiveFrom, effectiveTo)`. */
export type EffectiveDated = {
  readonly effectiveFrom: IsoDate;
  readonly effectiveTo: IsoDate | null;
};

export type TaxRateRow = EffectiveDated & {
  readonly jurisdictionCode: string;
  readonly component: TaxComponent;
  readonly rateMillipercent: number;
};

export type SupplyTreatmentRow = EffectiveDated & {
  readonly supplyTypeCode: SupplyType;
  readonly treatment: TaxTreatment;
  readonly components: ReadonlyArray<TaxComponent>;
  readonly placeOfSupply: PlaceOfSupply;
};

export type TaxRegistrationRow = EffectiveDated & {
  readonly jurisdictionCode: string;
  readonly program: string;
  readonly components: ReadonlyArray<TaxComponent>;
  readonly registrationNumber: string | null;
  readonly registered: boolean;
  readonly isPlaceholder: boolean;
};

/** The live (not deleted) configuration rows. Rows not in force on a given
 * day are ignored by the resolver, so a snapshot may hold history too. */
export type TaxSnapshot = {
  readonly rates: ReadonlyArray<TaxRateRow>;
  readonly treatments: ReadonlyArray<SupplyTreatmentRow>;
  readonly registrations: ReadonlyArray<TaxRegistrationRow>;
};

/** One frozen tax line — stored as-is on payments and cycles. */
export type TaxLine = {
  readonly supplyType: SupplyType;
  readonly jurisdiction: string;
  readonly component: TaxComponent;
  readonly rateMillipercent: number;
  readonly baseCents: number;
  readonly taxCents: number;
  /** "HST (ON) 13%". */
  readonly label: string;
  /** Poppynz's registration for the component, printed on receipts; null
   * while the number on file is a placeholder (receipts say "pending"). */
  readonly registrationNumber: string | null;
};

export type TaxProvinces = {
  readonly payer?: ProvinceCode | null;
  readonly helper?: ProvinceCode | null;
  readonly contract?: ProvinceCode | null;
};

export type TaxResolutionError =
  | { readonly reason: 'treatment_missing'; readonly supplyType: SupplyType }
  | {
      readonly reason: 'province_required';
      readonly supplyType: SupplyType;
      readonly placeOfSupply: PlaceOfSupply;
    }
  | {
      readonly reason: 'rate_missing';
      readonly supplyType: SupplyType;
      readonly province: ProvinceCode;
    };

export type TaxResolution =
  | { readonly ok: true; readonly lines: ReadonlyArray<TaxLine>; readonly taxCents: number }
  | { readonly ok: false; readonly error: TaxResolutionError };

/** The federal jurisdiction code (GST/HST registrations). */
const FEDERAL = 'CA';

export const inForce = (row: EffectiveDated, on: IsoDate): boolean =>
  row.effectiveFrom <= on && (row.effectiveTo === null || on < row.effectiveTo);

const NAME_TO_CODE: Record<string, ProvinceCode> = Object.fromEntries(
  Object.entries(PROVINCES).flatMap(([code, name]) => [
    [code.toLowerCase(), code as ProvinceCode],
    [name.toLowerCase(), code as ProvinceCode]
  ])
);
// Common spellings people type into an address form.
NAME_TO_CODE['québec'] = 'QC';
NAME_TO_CODE['newfoundland'] = 'NL';
NAME_TO_CODE['pei'] = 'PE';
NAME_TO_CODE['yukon territory'] = 'YT';

/** A profile's `state_province` (code or name, any case) → province code.
 * Canada only: another country (or garbage) is null — the caller refuses the
 * quote rather than guessing. */
export const normaliseProvince = (
  stateProvince: string | null | undefined,
  country?: string | null
): ProvinceCode | null => {
  if (country != null && country.trim() !== '') {
    const c = country.trim().toLowerCase();
    if (c !== 'ca' && c !== 'can' && c !== 'canada') return null;
  }
  if (stateProvince == null) return null;
  const key = stateProvince.trim().toLowerCase().replace(/\s+/g, ' ');
  return NAME_TO_CODE[key] ?? null;
};

/** 13000 → "13", 9975 → "9.975", 14000 → "14". */
export const formatRate = (rateMillipercent: number): string => {
  const whole = Math.floor(rateMillipercent / 1000);
  const fraction = rateMillipercent % 1000;
  return fraction === 0
    ? `${whole}`
    : `${whole}.${String(fraction).padStart(3, '0').replace(/0+$/, '')}`;
};

export const taxLineLabel = (
  component: TaxComponent,
  jurisdiction: string,
  rateMillipercent: number
): string => `${component.toUpperCase()} (${jurisdiction}) ${formatRate(rateMillipercent)}%`;

const provinceFor = (placeOfSupply: PlaceOfSupply, provinces: TaxProvinces) => {
  switch (placeOfSupply) {
    case 'payer_province':
      return provinces.payer ?? null;
    case 'helper_province':
      return provinces.helper ?? null;
    case 'contract_location':
      return provinces.contract ?? null;
  }
};

/** The tax on one supply of `baseCents`, on `on`. A zero base carries no
 * tax and needs no province (an empty basket, a cycle with nothing in it). */
export const computeSupplyTax = (input: {
  snapshot: TaxSnapshot;
  supplyType: SupplyType;
  baseCents: number;
  on: IsoDate;
  provinces: TaxProvinces;
}): TaxResolution => {
  const { snapshot, supplyType, baseCents, on } = input;
  const treatment = snapshot.treatments.find(
    (row) => row.supplyTypeCode === supplyType && inForce(row, on)
  );
  if (!treatment) return { ok: false, error: { reason: 'treatment_missing', supplyType } };
  if (treatment.treatment !== 'taxable' || baseCents === 0) {
    return { ok: true, lines: [], taxCents: 0 };
  }
  const province = provinceFor(treatment.placeOfSupply, input.provinces);
  if (province === null) {
    return {
      ok: false,
      error: { reason: 'province_required', supplyType, placeOfSupply: treatment.placeOfSupply }
    };
  }

  const lines: Array<TaxLine> = [];
  let registeredComponents = 0;
  for (const component of treatment.components) {
    // A federal registration (CA: GST/HST) covers every province; a
    // provincial one (QC: QST) only its own.
    const registration = snapshot.registrations.find(
      (row) =>
        row.registered &&
        (row.jurisdictionCode === FEDERAL || row.jurisdictionCode === province) &&
        row.components.includes(component) &&
        inForce(row, on)
    );
    if (!registration) continue;
    registeredComponents += 1;
    const rate = snapshot.rates.find(
      (row) => row.jurisdictionCode === province && row.component === component && inForce(row, on)
    );
    if (!rate) continue;
    lines.push({
      supplyType,
      jurisdiction: province,
      component,
      rateMillipercent: rate.rateMillipercent,
      baseCents,
      taxCents: roundHalfUp(baseCents * rate.rateMillipercent, MILLIPERCENT_DENOMINATOR),
      label: taxLineLabel(component, province, rate.rateMillipercent),
      // A placeholder number is never printed: receipts say "pending".
      registrationNumber: registration.isPlaceholder ? null : registration.registrationNumber
    });
  }
  if (registeredComponents > 0 && lines.length === 0) {
    return { ok: false, error: { reason: 'rate_missing', supplyType, province } };
  }
  return { ok: true, lines, taxCents: lines.reduce((sum, line) => sum + line.taxCents, 0) };
};

export const sumTax = (lines: ReadonlyArray<TaxLine>): number =>
  lines.reduce((sum, line) => sum + line.taxCents, 0);
