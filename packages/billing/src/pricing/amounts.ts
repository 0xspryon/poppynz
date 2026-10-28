import { applyBps, sessionValueCents } from './rounding';
import {
  computeSupplyTax,
  sumTax,
  type ProvinceCode,
  type TaxLine,
  type TaxResolutionError,
  type TaxSnapshot
} from './tax';

/** A calendar date, `YYYY-MM-DD`. */
type IsoDate = string;

/**
 * What one contract cycle (or one week of the pattern, for the breakdown
 * shown before acceptance) costs and pays, umbrella §6:
 *
 *   family pays   = service + serviceTax + fee + feeTax
 *   helper gets   = service + serviceTax − commission − commissionTax
 *
 * The care service value is the helper's supply (exempt by default); the
 * family fee and the commission are Poppynz's own supplies.
 */
export type ContractAmounts = {
  readonly serviceCents: number;
  readonly serviceTaxLines: ReadonlyArray<TaxLine>;
  readonly familyFeeBps: number;
  readonly familyFeeCents: number;
  readonly familyFeeTaxLines: ReadonlyArray<TaxLine>;
  readonly familyTotalCents: number;
  readonly providerCommissionBps: number;
  readonly providerCommissionCents: number;
  readonly providerCommissionTaxLines: ReadonlyArray<TaxLine>;
  readonly providerShareCents: number;
  /** Tier 3 step 2: compensation for sessions cancelled late before the
   * capture — charged to the family with no fee, paid to the helper with no
   * commission (and its tax, out of scope by default). Included in the
   * family total and the helper's share. */
  readonly compensationCents: number;
  readonly compensationTaxLines: ReadonlyArray<TaxLine>;
};

export type ContractAmountsResult =
  | { readonly ok: true; readonly amounts: ContractAmounts }
  | { readonly ok: false; readonly error: TaxResolutionError };

export const quoteContractAmounts = (input: {
  serviceCents: number;
  familyFeeBps: number;
  providerCommissionBps: number;
  snapshot: TaxSnapshot;
  /** The supply date: the cycle's first day in the contract zone. */
  on: IsoDate;
  familyProvince: ProvinceCode | null;
  helperProvince: ProvinceCode | null;
  /** Late-cancellation compensation charged on top (default 0). */
  compensationCents?: number;
}): ContractAmountsResult => {
  // The family pays; the contract's location is the family's; the helper
  // receives the commission's supply.
  const provinces = {
    payer: input.familyProvince,
    contract: input.familyProvince,
    helper: input.helperProvince
  };
  const familyFeeCents = applyBps(input.serviceCents, input.familyFeeBps);
  const providerCommissionCents = applyBps(input.serviceCents, input.providerCommissionBps);
  const tax = (
    supplyType:
      | 'care_service_value'
      | 'family_service_fee'
      | 'provider_commission'
      | 'cancellation_compensation',
    baseCents: number
  ) =>
    computeSupplyTax({ snapshot: input.snapshot, supplyType, baseCents, on: input.on, provinces });

  const serviceTax = tax('care_service_value', input.serviceCents);
  if (!serviceTax.ok) return serviceTax;
  const feeTax = tax('family_service_fee', familyFeeCents);
  if (!feeTax.ok) return feeTax;
  const commissionTax = tax('provider_commission', providerCommissionCents);
  if (!commissionTax.ok) return commissionTax;
  const compensationCents = input.compensationCents ?? 0;
  const compensationTax =
    compensationCents > 0
      ? tax('cancellation_compensation', compensationCents)
      : ({ ok: true, lines: [] } as const);
  if (!compensationTax.ok) return compensationTax;
  const compensationTotal = compensationCents + sumTax(compensationTax.lines);

  const serviceTaxCents = sumTax(serviceTax.lines);
  return {
    ok: true,
    amounts: {
      serviceCents: input.serviceCents,
      serviceTaxLines: serviceTax.lines,
      familyFeeBps: input.familyFeeBps,
      familyFeeCents,
      familyFeeTaxLines: feeTax.lines,
      familyTotalCents:
        input.serviceCents +
        serviceTaxCents +
        familyFeeCents +
        sumTax(feeTax.lines) +
        compensationTotal,
      providerCommissionBps: input.providerCommissionBps,
      providerCommissionCents,
      providerCommissionTaxLines: commissionTax.lines,
      providerShareCents:
        input.serviceCents +
        serviceTaxCents -
        providerCommissionCents -
        sumTax(commissionTax.lines) +
        compensationTotal,
      compensationCents,
      compensationTaxLines: compensationTax.lines
    }
  };
};

/** One week of the agreed pattern, valued session by session with the same
 * rounding billing uses (wall-clock minutes — the dated sessions billing
 * charges use real elapsed minutes, so a DST week differs by the hour). */
export const weeklyServiceCents = (
  services: ReadonlyArray<{
    rateCents: number;
    sessions: ReadonlyArray<{ startMinutes: number; endMinutes: number }>;
  }>
): number =>
  services.reduce(
    (total, service) =>
      total +
      service.sessions.reduce(
        (sum, session) =>
          sum + sessionValueCents(service.rateCents, session.endMinutes - session.startMinutes),
        0
      ),
    0
  );

/** Below this a card charge is refused by the provider (CAD $0.50). */
export const MINIMUM_CHARGE_CENTS = 50;

export type CheckQuoteTax =
  | {
      readonly ok: true;
      readonly lines: ReadonlyArray<TaxLine>;
      readonly taxCents: number;
    }
  | { readonly ok: false; readonly error: TaxResolutionError };

/** Background checks: the checks and the administration fee are separate
 * supplies, both taxed at the payer's province (family or helper). */
export const quoteCheckTax = (input: {
  snapshot: TaxSnapshot;
  on: IsoDate;
  payerProvince: ProvinceCode | null;
  checksCents: number;
  adminFeeCents: number;
}): CheckQuoteTax => {
  const provinces = { payer: input.payerProvince };
  const checks = computeSupplyTax({
    snapshot: input.snapshot,
    supplyType: 'credibled_check',
    baseCents: input.checksCents,
    on: input.on,
    provinces
  });
  if (!checks.ok) return checks;
  const fee = computeSupplyTax({
    snapshot: input.snapshot,
    supplyType: 'credibled_admin_fee',
    baseCents: input.adminFeeCents,
    on: input.on,
    provinces
  });
  if (!fee.ok) return fee;
  const lines = [...checks.lines, ...fee.lines];
  return { ok: true, lines, taxCents: sumTax(lines) };
};
