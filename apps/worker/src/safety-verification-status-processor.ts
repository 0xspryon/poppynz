import {
  canApplyCredibledTransition,
  credibledOutcomeFromStatus,
  credibledStatusToCheckOrderStatus,
  Credibled
} from '@repo/credibled';
import { CheckOrderRepo, inFlightCheckOrderStatuses, type CheckOrder } from '@repo/db';
import { safetyVerificationConfig } from '@repo/env';
import { Effect } from 'effect';
import { publishNotificationBestEffort } from '@repo/notify';

/**
 * Reconcile poller — the recovery path for dropped Credibled webhooks.
 *
 * Credibled logs a failed webhook delivery and never retries it, so without
 * this sweep a completed check can sit unnoticed forever. It is not a
 * nice-to-have: it is the only thing that makes webhook delivery non-critical.
 *
 * Shares its transition rules with the webhook handler, so a poll and a
 * delivery arriving in either order converge on the same state — and the
 * repository's guarded completion means the two can never produce two
 * verdicts for one order.
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

const audienceFor = (order: CheckOrder) =>
  order.role === 'family' ? ('family' as const) : ('service-provider' as const);

const reconcileOne = (order: CheckOrder, months: number) =>
  Effect.gen(function* () {
    if (!order.credibledCheckUuid) {
      return 'skipped';
    }

    const orders = yield* CheckOrderRepo;
    const credibled = yield* Credibled;

    const status = yield* credibled
      .getCheckStatus(audienceFor(order), order.credibledCheckUuid)
      .pipe(Effect.option);

    if (status._tag === 'None') {
      return 'unreachable';
    }

    const next = credibledStatusToCheckOrderStatus(status.value.applicationStatus);
    if (!canApplyCredibledTransition(order.status, next)) {
      return 'unchanged';
    }

    if (next === 'complete') {
      // Only a genuine Complete carries dates; Action Required and In Dispute
      // leave the validity window to the administrator's decision.
      const completed = status.value.applicationStatus === 'Complete';
      const now = new Date();
      const result = yield* orders.complete(order.id, {
        completedAt: now,
        // The status read carries per-check scores but no overall one, so
        // clearance is inferred from every check being Cleared.
        result: credibledOutcomeFromStatus(status.value),
        verification: {
          consentAt: order.consentAt,
          consentPolicyVersion: order.consentPolicyVersion,
          issuedOn: completed ? toDateOnly(now) : null,
          expiresOn: completed ? toDateOnly(addMonths(now, months)) : null
        }
      });
      // Null means a webhook got there first — nothing to do.
      if (!result) {
        return 'unchanged';
      }
      yield* publishNotificationBestEffort(order.userId, {
        type: 'safety_verification.updated',
        payload: { status: 'review_required' }
      });
      return 'advanced';
    }

    // Guarded like completion is: a webhook that completed this order between
    // our read and our write must not be dragged back to `in_progress`.
    const advanced = yield* orders.advance(order.id, {
      from: { status: inFlightCheckOrderStatuses },
      set: { status: next }
    });

    if (!advanced) {
      return 'unchanged';
    }
    // Anything short of `complete` that passed the forward-transition check
    // is one of the two in-flight stages the applicant can see.
    if (next === 'invited' || next === 'in_progress') {
      yield* publishNotificationBestEffort(order.userId, {
        type: 'safety_verification.updated',
        payload: { status: next }
      });
    }
    return 'advanced';
  });

export const reconcileCheckOrderStatuses = Effect.gen(function* () {
  const orders = yield* CheckOrderRepo;
  const months = yield* validityMonths;
  const inFlight = yield* orders.listInFlight();

  const outcomes = yield* Effect.forEach(
    inFlight,
    (order) => reconcileOne(order, months).pipe(Effect.orElseSucceed(() => 'failed' as const)),
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
