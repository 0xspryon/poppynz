/**
 * The frozen per-session split (Tier 3 step 2, spec 2026-10-28 §5).
 *
 * A cycle's family fee and taxes are computed ONCE on the cycle total and
 * rounded (one rounding rule). Recomputing them per session would not add
 * up to what was charged, so every charged amount is instead DIVIDED among
 * the cycle's charged sessions in proportion to their care value, by the
 * largest-remainder method, and the result is frozen at capture:
 *
 *   1. exact share = C × value_i / Σ value; take the floor in cents;
 *   2. the leftover cents (fewer than the number of sessions) go one each to
 *      the largest fractional remainders; ties go to the earlier session (by
 *      start time, then slot);
 *   3. care is not allocated — each session's care is its own value;
 *      helper share = care (+ care tax) − commission − commission tax.
 *
 * Every component (the fee, each fee-tax line, the commission, each
 * commission-tax line, each care-tax line) adds up to the cycle amount to
 * the cent, so session refunds can never total more (or less) than what was
 * charged. Pure and browser-safe (no imports outside this folder).
 *
 * A carried-in amount (a sub-50¢ carry from an earlier cycle) takes part in
 * the proportions as its own line, `carry`, and is never allocated to a
 * session. A session cancelled late BEFORE the capture is charged its
 * compensation only (`compensationCents`): no fee, no commission, all of it
 * the helper's — its own `compensation` basis.
 */

export type SplitTaxLine = {
  readonly supplyType: string;
  readonly jurisdiction: string;
  readonly component: string;
  readonly rateMillipercent: number;
  readonly baseCents: number;
  readonly taxCents: number;
  readonly label: string;
  readonly registrationNumber: string | null;
};

export type SplitSessionInput = {
  readonly sessionId: string;
  readonly startsAt: Date;
  readonly slot: string;
  /** The session's care value (its own, never allocated). */
  readonly valueCents: number;
  /** > 0: cancelled late before the capture — charged this compensation
   * only, outside the proportions. */
  readonly compensationCents?: number;
};

/** What the cycle actually charged, component by component. */
export type SplitInput = {
  readonly sessions: ReadonlyArray<SplitSessionInput>;
  readonly carriedInCents: number;
  readonly serviceTaxLines: ReadonlyArray<SplitTaxLine>;
  readonly familyFeeCents: number;
  readonly familyFeeTaxLines: ReadonlyArray<SplitTaxLine>;
  readonly providerCommissionCents: number;
  readonly providerCommissionTaxLines: ReadonlyArray<SplitTaxLine>;
  /** Tax on the compensation (out of scope by default: none). */
  readonly compensationTaxLines: ReadonlyArray<SplitTaxLine>;
};

export type SessionChargeSplit = {
  /** The session's id; `carry` for the carried-in line. */
  readonly sessionId: string;
  readonly basis: 'session' | 'compensation' | 'carry';
  readonly careCents: number;
  readonly careTaxLines: ReadonlyArray<SplitTaxLine>;
  readonly careTaxCents: number;
  readonly familyFeeCents: number;
  readonly familyFeeTaxLines: ReadonlyArray<SplitTaxLine>;
  readonly familyFeeTaxCents: number;
  /** care + care tax + fee + fee tax: what the family paid for it. */
  readonly familyTotalCents: number;
  readonly commissionCents: number;
  readonly commissionTaxLines: ReadonlyArray<SplitTaxLine>;
  readonly commissionTaxCents: number;
  /** care + care tax − commission − commission tax. */
  readonly helperShareCents: number;
};

export type CycleSplit = {
  /** Ordered by start time, then slot. */
  readonly sessions: ReadonlyArray<SessionChargeSplit>;
  /** The carried-in line, or null without a carry. */
  readonly carry: SessionChargeSplit | null;
};

/**
 * Divides `total` cents in proportion to `weights` (largest remainder; ties
 * to the lower index). Integer arithmetic only: the remainders compared are
 * `total × weight mod Σ weights`, exact.
 */
export const allocateLargestRemainder = (
  total: number,
  weights: ReadonlyArray<number>
): Array<number> => {
  const sum = weights.reduce((t, w) => t + w, 0);
  if (sum === 0) {
    if (total !== 0) throw new RangeError(`cannot allocate ${total} over zero weights`);
    return weights.map(() => 0);
  }
  if (!Number.isSafeInteger(total * sum)) {
    throw new RangeError(`allocation too large: ${total} over ${sum}`);
  }
  const floors = weights.map((w) => Math.floor((total * w) / sum));
  const remainders = weights.map((w, index) => ({ index, remainder: (total * w) % sum }));
  let leftover = total - floors.reduce((t, f) => t + f, 0);
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of remainders) {
    if (leftover === 0) break;
    floors[index] = floors[index]! + 1;
    leftover -= 1;
  }
  return floors;
};

/** Each line divided by the weights; one array of lines per participant. */
const allocateLines = (
  lines: ReadonlyArray<SplitTaxLine>,
  weights: ReadonlyArray<number>
): Array<Array<SplitTaxLine>> => {
  const perLine = lines.map((line) => ({
    line,
    tax: allocateLargestRemainder(line.taxCents, weights),
    base: allocateLargestRemainder(line.baseCents, weights)
  }));
  return weights.map((_, index) =>
    perLine.map(({ line, tax, base }) => ({
      ...line,
      taxCents: tax[index]!,
      baseCents: base[index]!
    }))
  );
};

const sumTax = (lines: ReadonlyArray<SplitTaxLine>) =>
  lines.reduce((total, line) => total + line.taxCents, 0);

const byStart = (a: SplitSessionInput, b: SplitSessionInput) =>
  a.startsAt.getTime() - b.startsAt.getTime() || (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0);

const row = (input: {
  sessionId: string;
  basis: SessionChargeSplit['basis'];
  careCents: number;
  careTaxLines: ReadonlyArray<SplitTaxLine>;
  familyFeeCents: number;
  familyFeeTaxLines: ReadonlyArray<SplitTaxLine>;
  commissionCents: number;
  commissionTaxLines: ReadonlyArray<SplitTaxLine>;
}): SessionChargeSplit => {
  const careTaxCents = sumTax(input.careTaxLines);
  const familyFeeTaxCents = sumTax(input.familyFeeTaxLines);
  const commissionTaxCents = sumTax(input.commissionTaxLines);
  return {
    ...input,
    careTaxCents,
    familyFeeTaxCents,
    familyTotalCents: input.careCents + careTaxCents + input.familyFeeCents + familyFeeTaxCents,
    commissionTaxCents,
    helperShareCents: input.careCents + careTaxCents - input.commissionCents - commissionTaxCents
  };
};

/** The split of one captured cycle (see the module comment). */
export const splitCycleCharge = (input: SplitInput): CycleSplit => {
  const ordered = [...input.sessions].sort(byStart);
  const charged = ordered.filter((session) => (session.compensationCents ?? 0) === 0);
  const compensated = ordered.filter((session) => (session.compensationCents ?? 0) > 0);

  // The proportional participants: charged sessions, then the carry.
  const weights = [
    ...charged.map((session) => session.valueCents),
    ...(input.carriedInCents > 0 ? [input.carriedInCents] : [])
  ];
  const fee = allocateLargestRemainder(input.familyFeeCents, weights);
  const commission = allocateLargestRemainder(input.providerCommissionCents, weights);
  const feeTax = allocateLines(input.familyFeeTaxLines, weights);
  const careTax = allocateLines(input.serviceTaxLines, weights);
  const commissionTax = allocateLines(input.providerCommissionTaxLines, weights);
  const compensationTax = allocateLines(
    input.compensationTaxLines,
    compensated.map((session) => session.compensationCents ?? 0)
  );

  const proportional = weights.map((weight, index) =>
    row({
      sessionId: index < charged.length ? charged[index]!.sessionId : 'carry',
      basis: index < charged.length ? 'session' : 'carry',
      careCents: weight,
      careTaxLines: careTax[index]!,
      familyFeeCents: fee[index]!,
      familyFeeTaxLines: feeTax[index]!,
      commissionCents: commission[index]!,
      commissionTaxLines: commissionTax[index]!
    })
  );
  const compensation = compensated.map((session, index) =>
    row({
      sessionId: session.sessionId,
      basis: 'compensation',
      careCents: session.compensationCents ?? 0,
      careTaxLines: compensationTax[index]!,
      familyFeeCents: 0,
      familyFeeTaxLines: [],
      commissionCents: 0,
      commissionTaxLines: []
    })
  );
  const bySession = new Map(
    [...proportional.slice(0, charged.length), ...compensation].map((split) => [
      split.sessionId,
      split
    ])
  );
  return {
    sessions: ordered.map((session) => bySession.get(session.sessionId)!),
    carry: input.carriedInCents > 0 ? proportional[charged.length]! : null
  };
};
