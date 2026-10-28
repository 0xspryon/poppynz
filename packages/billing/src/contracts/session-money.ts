import type { SessionRecord, SessionResolution } from '@repo/db';
import {
  allocateLargestRemainder,
  applyBps,
  roundHalfUp,
  type SessionChargeSplit,
  type SplitTaxLine
} from '../pricing';
import { cancellationCutoff, classifyCancellation } from './resolutions';

/**
 * The cancellation-policy function (Tier 3 step 2, spec 2026-10-28 §6).
 * Pure: from a session's frozen split (§5) and what happened to it, how much
 * goes back to the family, how much the helper is owed and what Poppynz
 * keeps — with the component breakdowns refunds, transfers, the ledger and
 * the tax report need.
 *
 * One side is computed and the other derived, so the cents always add up:
 * the helper's pay and the family's net are computed; the family refund is
 * what was paid minus that net. Policy v1 (founder-approved):
 *
 *   | Resolution                                | Helper                       | Family back                         |
 *   | family cancels ≥ notice before / day off  | $0                           | everything                          |
 *   | family late / no-show / reduced hours     | worked time + 25 % of the    | cancelled care − compensation       |
 *   |                                           | cancelled care (half up)     | + the cancelled share of fee & tax  |
 *   | helper cancels / no-show / helper day off | $0                           | everything                          |
 *   | open report or dispute                    | held                         | held                                |
 *
 * Early or late is measured from `recorded_at` against the cutoff — the
 * same wall-clock time `cancellationNoticeHours` earlier in the contract
 * zone (exactly the cutoff is timely) — for what a party recorded; an
 * admin's decision is taken as decided.
 */

/** A session's facts the policy reads. */
export type MoneySession = Pick<SessionRecord, 'date' | 'startMinutes' | 'elapsedMinutes'>;

export type MoneyResolution = {
  /** The session's active resolution (or its latest), null for none. */
  resolution: Pick<
    SessionResolution,
    | 'kind'
    | 'status'
    | 'reportedBySide'
    | 'recordedAt'
    | 'minutesWorked'
    | 'decision'
    | 'decisionMinutesWorked'
  > | null;
  session: MoneySession;
  /** The contract zone. */
  zone: string;
};

/** The policy in force (the signed agreement's version) and its settings. */
export type SessionMoneyPolicy = {
  /** The Terms of Service revision; every version so far is policy v1. */
  version: number | null;
  lateCancellationHelperBps: number;
  cancellationNoticeHours: number;
};

export type MoneyOutcome =
  /** Nothing in effect: the session went (or goes) ahead. */
  | { kind: 'none' }
  /** An open report or a dispute: both sides wait for the answer. */
  | { kind: 'held' }
  | { kind: 'family_early' }
  /** Late cancellation, no-show (0 worked) or reduced hours. */
  | { kind: 'family_late'; minutesWorked: number }
  | { kind: 'helper_cancelled' };

export type MoneyOutcomeKind = MoneyOutcome['kind'];

type Kind = SessionResolution['kind'] | NonNullable<SessionResolution['decision']>;

const outcomeOfKind = (
  kind: Kind,
  minutesWorked: number | null,
  input: MoneyResolution,
  policy: SessionMoneyPolicy,
  decided: boolean
): MoneyOutcome => {
  const worked = Math.min(Math.max(minutesWorked ?? 0, 0), input.session.elapsedMinutes);
  const cutoff = () =>
    cancellationCutoff(input.session, input.zone, policy.cancellationNoticeHours);
  switch (kind) {
    case 'family_cancelled_early':
    case 'family_cancelled_late': {
      if (decided || !input.resolution) {
        return kind === 'family_cancelled_early'
          ? { kind: 'family_early' }
          : { kind: 'family_late', minutesWorked: 0 };
      }
      return classifyCancellation('family', input.resolution.recordedAt, cutoff()) ===
        'family_cancelled_early'
        ? { kind: 'family_early' }
        : { kind: 'family_late', minutesWorked: 0 };
    }
    case 'family_no_show':
      return { kind: 'family_late', minutesWorked: 0 };
    case 'family_reduced_hours':
      return { kind: 'family_late', minutesWorked: worked };
    case 'helper_cancelled':
    case 'helper_no_show':
      return { kind: 'helper_cancelled' };
    case 'day_off_agreed': {
      // A family's day off is a family cancellation, a helper's a helper
      // cancellation (§3a), timed by when it was proposed.
      if (!input.resolution || input.resolution.reportedBySide === 'helper') {
        return { kind: 'helper_cancelled' };
      }
      return classifyCancellation('family', input.resolution.recordedAt, cutoff()) ===
        'family_cancelled_early'
        ? { kind: 'family_early' }
        : { kind: 'family_late', minutesWorked: 0 };
    }
    case 'as_scheduled':
      return { kind: 'none' };
    case 'disputed':
      // "Not provided", still undecided.
      return { kind: 'held' };
  }
};

/** What is in effect for the session now (status, decision and kind). */
export const effectiveSessionOutcome = (
  input: MoneyResolution,
  policy: SessionMoneyPolicy
): MoneyOutcome => {
  const r = input.resolution;
  if (r === null) return { kind: 'none' };
  switch (r.status) {
    case 'lapsed':
    case 'reversed':
      return { kind: 'none' };
    case 'proposed':
      // An unconfirmed day off changes nothing; an open report holds both
      // sides until it is answered or confirmed by silence.
      return r.kind === 'day_off_agreed' ? { kind: 'none' } : { kind: 'held' };
    case 'contested':
      return { kind: 'held' };
    case 'confirmed':
      return outcomeOfKind(r.kind, r.minutesWorked, input, policy, false);
    case 'decided':
      return r.decision === null
        ? { kind: 'held' }
        : outcomeOfKind(r.decision, r.decisionMinutesWorked ?? r.minutesWorked, input, policy, true);
  }
};

export type MoneyLines = ReadonlyArray<SplitTaxLine>;

export type SessionMoney = {
  outcome: MoneyOutcomeKind;
  /** Undecided: nothing moves either way until the answer. */
  held: boolean;
  /** Held amounts, when `held`: the family's paid total and the helper's share. */
  heldCents: { family: number; helper: number } | null;
  familyRefund: {
    careCents: number;
    careTaxLines: MoneyLines;
    feeCents: number;
    feeTaxLines: MoneyLines;
    totalCents: number;
  };
  /** What the family keeps paying for the session. */
  familyNetCents: number;
  helperOwed: {
    /** The worked share after its commission (and tax). */
    workedCents: number;
    /** The late-cancellation compensation (untaxed). */
    compensationCents: number;
    totalCents: number;
  };
  poppynzKeeps: {
    feeCents: number;
    feeTaxCents: number;
    commissionCents: number;
    commissionTaxCents: number;
    totalCents: number;
  };
  /** The commission (and its tax) NOT kept: no commission on cancelled hours. */
  commissionReversal: {
    commissionCents: number;
    commissionTaxLines: MoneyLines;
    commissionTaxCents: number;
  };
};

const sum = (lines: MoneyLines) => lines.reduce((total, line) => total + line.taxCents, 0);

/** Each line divided between [worked, cancelled] by care value. */
const divideLines = (lines: MoneyLines, weights: [number, number]) => {
  const parts = lines.map((line) => ({
    line,
    tax: allocateLargestRemainder(line.taxCents, weights),
    base: allocateLargestRemainder(line.baseCents, weights)
  }));
  const pick = (index: 0 | 1) =>
    parts.map(({ line, tax, base }) => ({ ...line, taxCents: tax[index]!, baseCents: base[index]! }));
  return { worked: pick(0), cancelled: pick(1) };
};

const nothing = (split: SessionChargeSplit, held: boolean, outcome: MoneyOutcomeKind): SessionMoney => ({
  outcome,
  held,
  heldCents: held ? { family: split.familyTotalCents, helper: split.helperShareCents } : null,
  familyRefund: { careCents: 0, careTaxLines: [], feeCents: 0, feeTaxLines: [], totalCents: 0 },
  familyNetCents: held ? 0 : split.familyTotalCents,
  helperOwed: held
    ? { workedCents: 0, compensationCents: 0, totalCents: 0 }
    : { workedCents: split.helperShareCents, compensationCents: 0, totalCents: split.helperShareCents },
  poppynzKeeps: held
    ? { feeCents: 0, feeTaxCents: 0, commissionCents: 0, commissionTaxCents: 0, totalCents: 0 }
    : {
        feeCents: split.familyFeeCents,
        feeTaxCents: split.familyFeeTaxCents,
        commissionCents: split.commissionCents,
        commissionTaxCents: split.commissionTaxCents,
        totalCents:
          split.familyFeeCents +
          split.familyFeeTaxCents +
          split.commissionCents +
          split.commissionTaxCents
      },
  commissionReversal: { commissionCents: 0, commissionTaxLines: [], commissionTaxCents: 0 }
});

/**
 * The money for one session under the policy in force (spec §6). `split`
 * is the session's frozen charge (or, before the capture, the provisional
 * split of the cycle's current quote, for previews).
 */
export const resolveSessionMoney = (
  split: SessionChargeSplit,
  resolution: MoneyResolution,
  policyVersion: SessionMoneyPolicy
): SessionMoney => {
  const outcome = effectiveSessionOutcome(resolution, policyVersion);
  if (outcome.kind === 'none') return nothing(split, false, 'none');
  if (outcome.kind === 'held') return nothing(split, true, 'held');

  if (split.basis === 'compensation') {
    // Charged its compensation only (cancelled late before the capture):
    // it stays the helper's unless the session is found to be a timely or
    // the helper's own cancellation after all.
    const back = outcome.kind === 'family_early' || outcome.kind === 'helper_cancelled';
    return {
      ...nothing(split, false, outcome.kind),
      familyRefund: back
        ? {
            careCents: split.careCents,
            careTaxLines: split.careTaxLines,
            feeCents: 0,
            feeTaxLines: [],
            totalCents: split.familyTotalCents
          }
        : { careCents: 0, careTaxLines: [], feeCents: 0, feeTaxLines: [], totalCents: 0 },
      familyNetCents: back ? 0 : split.familyTotalCents,
      helperOwed: back
        ? { workedCents: 0, compensationCents: 0, totalCents: 0 }
        : {
            workedCents: 0,
            compensationCents: split.helperShareCents,
            totalCents: split.helperShareCents
          },
      poppynzKeeps: { feeCents: 0, feeTaxCents: 0, commissionCents: 0, commissionTaxCents: 0, totalCents: 0 }
    };
  }

  // The worked part (paid normally) and the cancelled part, by care value.
  const minutesWorked = outcome.kind === 'family_late' ? outcome.minutesWorked : 0;
  const elapsed = resolution.session.elapsedMinutes;
  const workedCare =
    minutesWorked <= 0 || elapsed <= 0
      ? 0
      : minutesWorked >= elapsed
        ? split.careCents
        : roundHalfUp(split.careCents * minutesWorked, elapsed);
  const cancelledCare = split.careCents - workedCare;
  const weights: [number, number] = [workedCare, cancelledCare];
  const divide = (cents: number) =>
    split.careCents === 0 ? [0, cents] : allocateLargestRemainder(cents, weights);
  const linesOf = (lines: MoneyLines) =>
    split.careCents === 0 ? { worked: [], cancelled: [...lines] } : divideLines(lines, weights);

  const [workedFee = 0, cancelledFee = 0] = divide(split.familyFeeCents);
  const [workedCommission = 0, cancelledCommission = 0] = divide(split.commissionCents);
  const feeTax = linesOf(split.familyFeeTaxLines);
  const careTax = linesOf(split.careTaxLines);
  const commissionTax = linesOf(split.commissionTaxLines);

  const compensationCents =
    outcome.kind === 'family_late' ? applyBps(cancelledCare, policyVersion.lateCancellationHelperBps) : 0;
  // The helper side, computed …
  const workedCents = workedCare + sum(careTax.worked) - workedCommission - sum(commissionTax.worked);
  const helperTotal = workedCents + compensationCents;
  const keeps = {
    feeCents: workedFee,
    feeTaxCents: sum(feeTax.worked),
    commissionCents: workedCommission,
    commissionTaxCents: sum(commissionTax.worked)
  };
  const keepsTotal = keeps.feeCents + keeps.feeTaxCents + keeps.commissionCents + keeps.commissionTaxCents;
  // … and the family's derived from it.
  const familyNetCents = helperTotal + keepsTotal;
  const refundTotal = split.familyTotalCents - familyNetCents;
  return {
    outcome: outcome.kind,
    held: false,
    heldCents: null,
    familyRefund: {
      careCents: cancelledCare - compensationCents,
      careTaxLines: careTax.cancelled,
      feeCents: cancelledFee,
      feeTaxLines: feeTax.cancelled,
      totalCents: refundTotal
    },
    familyNetCents,
    helperOwed: { workedCents, compensationCents, totalCents: helperTotal },
    poppynzKeeps: { ...keeps, totalCents: keepsTotal },
    commissionReversal: {
      commissionCents: cancelledCommission,
      commissionTaxLines: commissionTax.cancelled,
      commissionTaxCents: sum(commissionTax.cancelled)
    }
  };
};
