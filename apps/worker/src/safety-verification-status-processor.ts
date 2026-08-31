import {
  canApplyCredibledTransition,
  credibledStatusToSafetyVerificationStatus,
  Credibled
} from '@repo/credibled';
import { SafetyVerificationRepo, type SafetyVerification } from '@repo/db';
import { safetyVerificationConfig } from '@repo/env';
import { Effect } from 'effect';

/**
 * Reconcile poller — the recovery path for dropped Credibled webhooks.
 *
 * Credibled logs a failed webhook delivery and never retries it, so without
 * this sweep a completed check can sit unnoticed forever. It is not a
 * nice-to-have: it is the only thing that makes webhook delivery non-critical.
 *
 * Shares its transition rules with the webhook handler, so a poll and a
 * delivery arriving in either order converge on the same state.
 */

const validityMonths = safetyVerificationConfig.pipe(
  Effect.map((policy) => policy.validityMonths),
  Effect.orElseSucceed(() => 12)
);

const toDateOnly = (at: Date) => at.toISOString().slice(0, 10);

const addMonths = (at: Date, months: number) => {
  const result = new Date(at.getTime());
  const target = result.getUTCMonth() + months;
  result.setUTCMonth(target);
  if (result.getUTCMonth() !== ((target % 12) + 12) % 12) {
    result.setUTCDate(0);
  }
  return result;
};

const audienceFor = (record: SafetyVerification) =>
  record.role === 'family' ? ('family' as const) : ('service-provider' as const);

const reconcileOne = (record: SafetyVerification, months: number) =>
  Effect.gen(function* () {
    if (!record.credibledCheckUuid) {
      return 'skipped';
    }

    const repo = yield* SafetyVerificationRepo;
    const credibled = yield* Credibled;

    const status = yield* credibled
      .getCheckStatus(audienceFor(record), record.credibledCheckUuid)
      .pipe(Effect.option);

    if (status._tag === 'None') {
      return 'unreachable';
    }

    const next = credibledStatusToSafetyVerificationStatus(status.value.applicationStatus);
    if (!canApplyCredibledTransition(record.status, next)) {
      return 'unchanged';
    }

    const completed = status.value.applicationStatus === 'Complete';
    const now = new Date();

    yield* repo.update(record.id, {
      status: next,
      issuedOn: completed ? toDateOnly(now) : record.issuedOn,
      expiresOn: completed ? toDateOnly(addMonths(now, months)) : record.expiresOn
    });

    return 'advanced';
  });

export const reconcileSafetyVerificationStatuses = Effect.gen(function* () {
  const repo = yield* SafetyVerificationRepo;
  const months = yield* validityMonths;
  const inFlight = yield* repo.listInFlight();

  const outcomes = yield* Effect.forEach(
    inFlight,
    (record) => reconcileOne(record, months).pipe(Effect.orElseSucceed(() => 'failed' as const)),
    // Deliberately modest: this runs every 15 minutes and Credibled rate-limits
    // per key. There is no deadline pressure on a backstop.
    { concurrency: 4 }
  );

  return {
    checked: inFlight.length,
    advanced: outcomes.filter((outcome) => outcome === 'advanced').length,
    unreachable: outcomes.filter((outcome) => outcome === 'unreachable').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length
  };
});
