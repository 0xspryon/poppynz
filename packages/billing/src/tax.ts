import { TaxConfigRepo, type TaxLiveConfig } from '@repo/db';
import { Data, Effect } from 'effect';
import type {
  PlaceOfSupply,
  ProvinceCode,
  SupplyType,
  TaxResolutionError,
  TaxSnapshot
} from './pricing';

/**
 * The tax configuration as quote time sees it: read from the database (never
 * from code or env) and handed to the pure resolver in `./pricing`. Callers
 * freeze the resulting lines on what they charge.
 */

/** Nobody can say where the supply is made: the quote is refused. */
export class TaxProvinceRequiredError extends Data.TaggedError('TaxProvinceRequiredError')<{
  supplyType: SupplyType;
  placeOfSupply: PlaceOfSupply;
  /** Whose profile lacks a province, when the caller knows. */
  party: 'family' | 'helper' | 'payer';
}> {}

/** A taxable supply with no rate configured where it is made. */
export class TaxRateMissingError extends Data.TaggedError('TaxRateMissingError')<{
  supplyType: SupplyType;
  province: ProvinceCode;
}> {}

/** A supply type without a treatment in force. */
export class TaxTreatmentMissingError extends Data.TaggedError('TaxTreatmentMissingError')<{
  supplyType: SupplyType;
}> {}

export type TaxQuoteError =
  | TaxProvinceRequiredError
  | TaxRateMissingError
  | TaxTreatmentMissingError;

const partyFor = (placeOfSupply: PlaceOfSupply): 'family' | 'helper' | 'payer' =>
  placeOfSupply === 'helper_province'
    ? 'helper'
    : placeOfSupply === 'contract_location'
      ? 'family'
      : 'payer';

/** The resolver's plain error → the typed error a route maps by `_tag`. */
export const toTaxQuoteError = (error: TaxResolutionError): TaxQuoteError => {
  switch (error.reason) {
    case 'province_required':
      return new TaxProvinceRequiredError({
        supplyType: error.supplyType,
        placeOfSupply: error.placeOfSupply,
        party: partyFor(error.placeOfSupply)
      });
    case 'rate_missing':
      return new TaxRateMissingError({ supplyType: error.supplyType, province: error.province });
    case 'treatment_missing':
      return new TaxTreatmentMissingError({ supplyType: error.supplyType });
  }
};

export const toTaxSnapshot = (config: TaxLiveConfig): TaxSnapshot => ({
  rates: config.rates.map((row) => ({
    jurisdictionCode: row.jurisdictionCode,
    component: row.component,
    rateMillipercent: row.rateMillipercent,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo
  })),
  treatments: config.treatments.map((row) => ({
    supplyTypeCode: row.supplyTypeCode as SupplyType,
    treatment: row.treatment,
    components: row.components,
    placeOfSupply: row.placeOfSupply,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo
  })),
  registrations: config.registrations.map((row) => ({
    jurisdictionCode: row.jurisdictionCode,
    program: row.program,
    components: row.components,
    registrationNumber: row.registrationNumber,
    registered: row.registered,
    isPlaceholder: row.isPlaceholder,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo
  }))
});

/** Every live configuration row; the resolver picks what is in force. */
export const loadTaxSnapshot = TaxConfigRepo.pipe(
  Effect.flatMap((repo) => repo.liveConfig()),
  Effect.map(toTaxSnapshot)
);
