import { addDays, instantAt, MINUTES_PER_DAY, todayIn } from '@repo/calendar';
import {
  ContractBillingRepo,
  ContractRepo,
  SessionResolutionRepo,
  type SessionRecord,
  type SessionResolution,
  type SessionResolutionKind
} from '@repo/db';
import { sessionResolutionConfig } from '@repo/env';
import { Effect } from 'effect';
import { contractBillingPolicy } from './engine';
import { sendResolutionNotice } from './resolution-notices';

/**
 * Session resolution rules (Tier 3, step 1 — spec 2026-10-28 §3, §3a, §6
 * classification). Pure: which actions a side may take on a session at a
 * given instant, how a cancellation is classified, and the deadlines. The
 * API refuses with exactly these reasons and the cycle page offers exactly
 * these actions, so the two never disagree.
 *
 * Step 1 records only. Nothing here changes what billing holds, charges or
 * pays, and `contract_sessions.status` is left alone: the engine charges
 * every `scheduled`/`completed` session, so moving one to `cancelled` or
 * `disputed` would change the next quote.
 */

export type PartySide = 'family' | 'helper';

export type SessionAction =
  | 'cancel'
  | 'propose_day_off'
  | 'report_no_show'
  | 'report_reduced_hours'
  | 'dispute';

export const sessionActions: ReadonlyArray<SessionAction> = [
  'cancel',
  'propose_day_off',
  'report_no_show',
  'report_reduced_hours',
  'dispute'
];

/** The other side's answer: a report is accepted or contested, a day-off
 * proposal accepted or declined. */
export type ResolutionResponse = 'accept' | 'contest' | 'decline';

/** Why an action is refused (each is its own API error code and toast). */
export type SessionActionRefusal =
  /** The session lies beyond the materialisation window. */
  | 'outside_window'
  /** Suspended or cancelled by billing: no care was due. */
  | 'session_unavailable'
  /** Cancelling or proposing a day off once the session has started. */
  | 'already_started'
  /** Reporting what happened before the session has started. */
  | 'not_started'
  /** More than the report window after the session ended. */
  | 'report_window_closed'
  /** A day off proposed at or after the cancellation cutoff. */
  | 'day_off_too_late'
  /** The session already has an active resolution. */
  | 'already_resolved'
  /** The action is the other side's (answering or disputing your own). */
  | 'wrong_side'
  /** Nothing is waiting for an answer. */
  | 'nothing_to_answer'
  /** The response window has closed (silence already counts). */
  | 'response_window_closed'
  /** The resolution is already with an admin, or decided. */
  | 'not_disputable'
  /** A report is accepted or contested; a day off accepted or declined. */
  | 'invalid_response'
  /** Reduced hours need the minutes worked, below the session's minutes. */
  | 'invalid_minutes';

export type ResolutionPolicy = {
  windowDays: number;
  cancellationNoticeHours: number;
  reportResponseHours: number;
  reportWindowHours: number;
  lateCancellationHelperBps: number;
};

/** The settings, read once per call. Malformed values fail loudly. */
export const sessionResolutionPolicy = Effect.all([
  contractBillingPolicy,
  sessionResolutionConfig.pipe(
    Effect.tapError((error) =>
      Effect.logError('[resolutions] session resolution settings are invalid', error)
    ),
    Effect.orDie
  )
]).pipe(
  Effect.map(
    ([billing, resolution]): ResolutionPolicy => ({
      windowDays: billing.sessionWindowDays,
      ...resolution
    })
  )
);

const HOUR_MS = 60 * 60 * 1000;

export type SessionFacts = Pick<
  SessionRecord,
  'date' | 'startMinutes' | 'startsAt' | 'endsAt' | 'elapsedMinutes' | 'status'
>;

/**
 * The cancellation cutoff: the same wall-clock time `hours` earlier in the
 * contract zone — for 24 h, the day before at the session's start time. A
 * DST change in between doesn't move it on the clock people read (it is 23
 * or 25 real hours then). A cutoff inside a spring-forward gap is the moment
 * the clock resumes.
 */
export const cancellationCutoff = (
  session: Pick<SessionRecord, 'date' | 'startMinutes'>,
  zone: string,
  hours: number
): Date => {
  const total = session.startMinutes - hours * 60;
  const days = Math.floor(total / MINUTES_PER_DAY);
  return instantAt(addDays(session.date, days), total - days * MINUTES_PER_DAY, zone);
};

/** A family cancellation recorded at or before the cutoff is early (exactly
 * the cutoff counts as early); after it, late. */
export const classifyCancellation = (
  side: PartySide,
  recordedAt: Date,
  cutoff: Date
): SessionResolutionKind =>
  side === 'helper'
    ? 'helper_cancelled'
    : recordedAt.getTime() <= cutoff.getTime()
      ? 'family_cancelled_early'
      : 'family_cancelled_late';

/** The last date with sessions in the window (today + window − 1). */
export const windowLastDate = (zone: string, now: Date, windowDays: number) =>
  addDays(todayIn(zone, now), windowDays - 1);

/** The kind a no-show report records: always about the OTHER side. */
export const noShowKind = (reporter: PartySide): SessionResolutionKind =>
  reporter === 'family' ? 'helper_no_show' : 'family_no_show';

export type ActionContext = {
  session: SessionFacts;
  zone: string;
  now: Date;
  policy: ResolutionPolicy;
  side: PartySide;
  /** The session's active resolution, if any. */
  active: SessionResolution | null;
};

const reportWindowEnd = (ctx: ActionContext) =>
  new Date(ctx.session.endsAt.getTime() + ctx.policy.reportWindowHours * HOUR_MS);

/** Null when `action` is allowed now, else why not. */
export const checkSessionAction = (
  action: SessionAction,
  ctx: ActionContext
): SessionActionRefusal | null => {
  const { session, now, active, side } = ctx;
  if (session.status === 'suspended' || session.status === 'cancelled') {
    return 'session_unavailable';
  }
  if (session.date > windowLastDate(ctx.zone, now, ctx.policy.windowDays)) {
    return 'outside_window';
  }
  const started = now.getTime() >= session.startsAt.getTime();
  switch (action) {
    case 'cancel':
      if (started) return 'already_started';
      return active ? 'already_resolved' : null;
    case 'propose_day_off': {
      if (started) return 'already_started';
      if (active) return 'already_resolved';
      const cutoff = cancellationCutoff(session, ctx.zone, ctx.policy.cancellationNoticeHours);
      return now.getTime() >= cutoff.getTime() ? 'day_off_too_late' : null;
    }
    case 'report_no_show':
    case 'report_reduced_hours':
      if (!started) return 'not_started';
      if (now > reportWindowEnd(ctx)) return 'report_window_closed';
      return active ? 'already_resolved' : null;
    case 'dispute':
      if (now > reportWindowEnd(ctx)) return 'report_window_closed';
      if (active) {
        if (active.reportedBySide === side) return 'wrong_side';
        return active.status === 'proposed' || active.status === 'confirmed'
          ? null
          : 'not_disputable';
      }
      // "It wasn't provided": only once the session was due to start.
      return started ? null : 'not_started';
  }
};

/** Null when `side` may answer the active resolution with `response` now. */
export const checkResponse = (
  response: ResolutionResponse,
  ctx: Pick<ActionContext, 'now' | 'side' | 'active'>
): SessionActionRefusal | null => {
  const { active, now, side } = ctx;
  if (!active || active.status !== 'proposed') return 'nothing_to_answer';
  if (active.reportedBySide === side) return 'wrong_side';
  if (active.respondBy !== null && now.getTime() >= active.respondBy.getTime()) {
    return 'response_window_closed';
  }
  const dayOff = active.kind === 'day_off_agreed';
  if (response === 'contest' && dayOff) return 'invalid_response';
  if (response === 'decline' && !dayOff) return 'invalid_response';
  return null;
};

/** The actions `side` may take on the session now, and how it may answer
 * what is waiting for it. */
export const availableSessionActions = (ctx: ActionContext) => ({
  actions: sessionActions.filter((action) => checkSessionAction(action, ctx) === null),
  responses: (['accept', 'contest', 'decline'] as const).filter(
    (response) => checkResponse(response, ctx) === null
  )
});

/** What recording `action` now would store (status, kind and deadline). */
export const plannedResolution = (
  action: Exclude<SessionAction, 'dispute'> | 'dispute_new',
  ctx: Pick<ActionContext, 'session' | 'zone' | 'now' | 'policy' | 'side'>
): {
  kind: SessionResolutionKind;
  status: 'proposed' | 'confirmed' | 'contested';
  respondBy: Date | null;
} => {
  const cutoff = cancellationCutoff(ctx.session, ctx.zone, ctx.policy.cancellationNoticeHours);
  const reportDeadline = new Date(ctx.now.getTime() + ctx.policy.reportResponseHours * HOUR_MS);
  switch (action) {
    case 'cancel':
      // Your own cancellation takes effect at once.
      return {
        kind: classifyCancellation(ctx.side, ctx.now, cutoff),
        status: 'confirmed',
        respondBy: null
      };
    case 'propose_day_off':
      // Needs the other side's confirmation; lapses at the cutoff.
      return { kind: 'day_off_agreed', status: 'proposed', respondBy: cutoff };
    case 'report_no_show':
      return { kind: noShowKind(ctx.side), status: 'proposed', respondBy: reportDeadline };
    case 'report_reduced_hours':
      return { kind: 'family_reduced_hours', status: 'proposed', respondBy: reportDeadline };
    case 'dispute_new':
      // "It wasn't provided" goes straight to the admin queue.
      return { kind: 'disputed', status: 'contested', respondBy: null };
  }
};

/** A family's day off counts as a family cancellation (early or late by
 * when it was proposed), a helper's as a helper cancellation (§3a). Step 2's
 * policy function reads it; step 1 shows it. */
export const dayOffClassification = (
  resolution: Pick<SessionResolution, 'reportedBySide' | 'recordedAt'>,
  session: Pick<SessionRecord, 'date' | 'startMinutes'>,
  zone: string,
  policy: Pick<ResolutionPolicy, 'cancellationNoticeHours'>
): SessionResolutionKind =>
  classifyCancellation(
    resolution.reportedBySide === 'helper' ? 'helper' : 'family',
    resolution.recordedAt,
    cancellationCutoff(session, zone, policy.cancellationNoticeHours)
  );

// ---------------------------------------------------------------------------
// The worker step: silence counts as acceptance; unanswered days off lapse.

export type ResolutionTickSummary = { confirmed: number; lapsed: number; failed: number };

/**
 * Runs in the 15-minute tick (and the dev clock's `--as-of`): every
 * `proposed` resolution whose response deadline has passed is confirmed
 * (a report nobody contested) or lapses (a day off nobody confirmed by the
 * cutoff). Compare-and-set, so a late answer and the tick can't both win;
 * each resolution is isolated — one failure never stops the others.
 */
export const runSessionResolutionTick = (now: Date) =>
  Effect.gen(function* () {
    const repo = yield* SessionResolutionRepo;
    const summary: ResolutionTickSummary = { confirmed: 0, lapsed: 0, failed: 0 };
    for (const due of yield* repo.listDue(now)) {
      const exit = yield* settleUnanswered(due, now).pipe(Effect.exit);
      if (exit._tag === 'Failure') {
        summary.failed += 1;
        yield* Effect.logError(`[resolutions] resolution ${due.id} failed`, exit.cause);
      } else if (exit.value === 'confirmed') {
        summary.confirmed += 1;
      } else if (exit.value === 'lapsed') {
        summary.lapsed += 1;
      }
    }
    return summary;
  });

const settleUnanswered = (due: SessionResolution, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* SessionResolutionRepo;
    const dayOff = due.kind === 'day_off_agreed';
    const moved = yield* repo.advance(
      due.id,
      { from: ['proposed'], set: { status: dayOff ? 'lapsed' : 'confirmed' } },
      {
        actorUserId: null,
        actorSide: 'system',
        action: dayOff ? 'lapsed' : 'confirmed_by_silence',
        note: dayOff
          ? 'No answer before the cancellation cutoff.'
          : 'No answer within the response window.'
      }
    );
    if (!moved) return 'skipped' as const;
    yield* noticeFor(moved, dayOff ? 'lapsed' : 'confirmed');
    return dayOff ? ('lapsed' as const) : ('confirmed' as const);
  });

/** Loads what a notice needs and sends it to both parties (best-effort). */
export const noticeFor = (
  resolution: SessionResolution,
  event: Parameters<typeof sendResolutionNotice>[0]
) =>
  Effect.gen(function* () {
    const contract = yield* (yield* ContractRepo).findById(resolution.contractId);
    const billingRepo = yield* ContractBillingRepo;
    const billing = yield* billingRepo.findBilling(resolution.contractId);
    const session = (yield* billingRepo.listSessions(
      resolution.contractId,
      resolution.cycleId
    )).find((row) => row.id === resolution.sessionId);
    if (!contract || !billing || !session) return;
    const policy = yield* sessionResolutionPolicy;
    yield* sendResolutionNotice(event, {
      contract,
      session,
      resolution,
      zone: billing.timeZone,
      policy
    });
  }).pipe(
    Effect.catchAll((error) =>
      Effect.logWarning(`[resolutions] notice ${event} for ${resolution.id} failed`, error)
    )
  );
