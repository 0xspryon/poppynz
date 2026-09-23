import { credibledCheckTypes, isCredibledCheckTypeValue, type CredibledCheckTypeValue } from './check-types';
import type { CredibledCheckStatus } from './client';

// What Credibled concluded about a finished check, read off its own result
// fields. This never decides a verdict — completing an order still lands in
// review_required and a person decides — it is what the reviewing
// administrator sees first, and what orders the queue.
//
// Mirrors the `check_order_outcome` enum in @repo/db (duplicated for the same
// leaf-package reason as poppynz-status.ts).
export const checkOrderOutcomes = ['cleared', 'not_cleared', 'inconclusive'] as const;
export type CheckOrderOutcome = (typeof checkOrderOutcomes)[number];

export type CredibledCheckResult = {
  /** Our stable check-type value, when Credibled's entry could be matched to
   * one. Unmatched entries are kept for the record but attach to no item. */
  readonly value: CredibledCheckTypeValue | null;
  readonly name: string;
  readonly status: string | null;
  readonly score: string | null;
  readonly outcome: CheckOrderOutcome;
};

export type CredibledCheckOutcome = {
  readonly outcome: CheckOrderOutcome;
  /** Credibled's overall score, verbatim (e.g. "Cleared"). */
  readonly score: string | null;
  readonly checks: ReadonlyArray<CredibledCheckResult>;
};

/** The webhook body fields this reads. Everything is `unknown` because the
 * body is untrusted input and Credibled documents none of it. */
export type CredibledWebhookResultFields = {
  application_status?: unknown;
  score?: unknown;
  scan_list?: unknown;
  check_executions?: unknown;
};

const text = (input: unknown): string | null => {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// "None" is what Credibled sends before anything is scored (the top-level
// `status` field reads "None" on a finished check too), so it means absent,
// not adverse.
const scoreOf = (input: unknown): string | null => {
  const value = text(input);
  return value && value.toLowerCase() !== 'none' ? value : null;
};

const isCleared = (score: string) => score.toLowerCase() === 'cleared';

// A score we have is either Cleared or it is adverse: Credibled's vocabulary
// for the other results is undocumented, and an unfamiliar word must reach the
// administrator as a flag, never pass as a clearance.
const outcomeOfScore = (score: string | null): CheckOrderOutcome =>
  score === null ? 'inconclusive' : isCleared(score) ? 'cleared' : 'not_cleared';

const records = (input: unknown): Array<Record<string, unknown>> =>
  Array.isArray(input)
    ? input.filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
    )
    : [];

/** Resolves Credibled's name for a check to our value. The webhook's
 * scan_list carries the value itself; the status endpoint carries only a
 * name, which may be the label ("Canadian Credential Verification") or the
 * value without its prefix ("credential_verification"). */
export const resolveCredibledCheckValue = (
  nameOrValue: string | null
): CredibledCheckTypeValue | null => {
  if (!nameOrValue) return null;
  const candidate = nameOrValue.trim();
  if (isCredibledCheckTypeValue(candidate)) return candidate;
  const prefixed = `request_${candidate.toLowerCase()}`;
  if (isCredibledCheckTypeValue(prefixed)) return prefixed;
  const lowered = candidate.toLowerCase();
  return credibledCheckTypes.find((type) => type.label.toLowerCase() === lowered)?.value ?? null;
};

const combine = (
  applicationStatus: string | null,
  score: string | null,
  checks: ReadonlyArray<CredibledCheckResult>,
  executionsComplete: boolean
): CheckOrderOutcome => {
  const scores = [score, ...checks.map((check) => check.score)].filter(
    (entry): entry is string => entry !== null
  );
  // Any adverse score wins, whatever the application status says — an
  // Action Required check with a record on it is still a record.
  if (scores.some((entry) => !isCleared(entry))) return 'not_cleared';
  // Cleared means Credibled finished, said so overall, and every check it ran
  // completed. Anything short of that is for a person to read in the report.
  if (applicationStatus !== 'Complete' || score === null || !executionsComplete) {
    return 'inconclusive';
  }
  return 'cleared';
};

/** Reads the result off a webhook delivery. */
export const credibledOutcomeFromWebhook = (
  payload: CredibledWebhookResultFields
): CredibledCheckOutcome => {
  const applicationStatus = text(payload.application_status);
  const score = scoreOf(payload.score);

  const checks = records(payload.scan_list).map((entry): CredibledCheckResult => {
    const checkScore = scoreOf(entry.score);
    return {
      value: resolveCredibledCheckValue(text(entry.value)),
      name: text(entry.scanName) ?? text(entry.value) ?? 'Unknown check',
      status: text(entry.application_status),
      score: checkScore,
      outcome: outcomeOfScore(checkScore)
    };
  });

  // check_executions is the per-check execution state; a check that errored
  // or never ran can sit behind an overall "Complete".
  const executionsComplete = records(payload.check_executions).every(
    (entry) => text(entry.status)?.toUpperCase() === 'COMPLETE'
  );

  return {
    outcome: combine(applicationStatus, score, checks, executionsComplete),
    score,
    checks
  };
};

/** Reads the result off the reconcile poller's status read. That endpoint
 * carries no overall score, so an all-Cleared set of checks stands in for
 * it. */
export const credibledOutcomeFromStatus = (status: CredibledCheckStatus): CredibledCheckOutcome => {
  const checks = status.checkStatuses.map((entry): CredibledCheckResult => {
    const checkScore = scoreOf(entry.score);
    return {
      value: resolveCredibledCheckValue(entry.checkTypeName),
      name: entry.checkTypeName,
      status: text(entry.status),
      score: checkScore,
      outcome: outcomeOfScore(checkScore)
    };
  });

  const allScored = checks.length > 0 && checks.every((check) => check.score !== null);
  const derivedScore =
    allScored && checks.every((check) => check.outcome === 'cleared') ? 'Cleared' : null;

  return {
    outcome: combine(status.applicationStatus, derivedScore, checks, true),
    score: derivedScore,
    checks
  };
};
