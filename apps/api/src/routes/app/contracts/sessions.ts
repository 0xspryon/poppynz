/**
 * Session actions (Tier 3, step 1 — spec 2026-10-28 §3, §3a, §10): a
 * contract's family or helper cancels a session, proposes a day off, reports
 * a no-show or reduced hours, disputes, or answers the other side — on a
 * session that exists (the materialisation window) and only while the rules
 * in `@repo/billing` allow it. Every refusal is typed (one error code each).
 *
 * Step 2 (money): after each change the session's money is reconciled at
 * once (`reconcileSession`: left out of the plan, a reduced capture, a
 * session refund, a recovery) — best-effort, the tick applies it otherwise.
 * What an action would do to the money is previewed by `./session-money`.
 */
import type { SqlError } from '@effect/sql/SqlError';
import {
  availableSessionActions,
  cancellationCutoff,
  checkResponse,
  checkSessionAction,
  dayOffClassification,
  noticeFor,
  plannedResolution,
  reconcileSession,
  sessionResolutionPolicy,
  type PartySide,
  type ResolutionPolicy,
  type ResolutionResponse,
  type SessionActionRefusal
} from '@repo/billing';
import {
  ContractAgreementRepo,
  ContractBillingRepo,
  ContractRepo,
  SessionResolutionRepo,
  activeResolutionStatuses,
  type Contract,
  type SessionRecord,
  type SessionResolution
} from '@repo/db';
import { Data, Effect, Schema } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { authenticate, requirePermissions, type UserAndSession } from '@/api/lib/effect-auth';
import { parseJsonBody, validateInput } from '@/api/lib/schema-validator';
import { loadCancellationPolicy } from './agreement';
import { validateContractId } from './contracts.validator';

// ---------------------------------------------------------------------------
// Errors

export class SessionRepoError extends Data.TaggedError('SessionRepoError')<{
  cause: SqlError;
}> {}

/** Unknown contract or session, or the viewer isn't one of the contract's
 * parties (outsiders can't tell the difference). */
export class SessionNotFoundError extends Data.TaggedError('SessionNotFoundError')<{}> {}

/** The rules refuse the action now (see `SessionActionRefusal`). */
export class SessionActionRefusedError extends Data.TaggedError('SessionActionRefusedError')<{
  reason: SessionActionRefusal;
}> {}

export const mapSessionRepoError = <A, R>(effect: Effect.Effect<A, SqlError, R>) =>
  effect.pipe(Effect.catchTag('SqlError', (cause) => Effect.fail(new SessionRepoError({ cause }))));

const refuse = (reason: SessionActionRefusal) =>
  Effect.fail(new SessionActionRefusedError({ reason }));

// ---------------------------------------------------------------------------
// Input

export const sessionReasonCodes = [
  'illness',
  'family_emergency',
  'schedule_change',
  'holiday',
  'other'
] as const;

const optionalText = Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(1000))));

export const sessionActionValidationError = {
  code: 'INVALID_SESSION_ACTION',
  message: 'Choose an action; reduced hours need the minutes worked.'
} as const;

export const sessionActionSchema = Schema.Struct({
  action: Schema.Literal(
    'cancel',
    'propose_day_off',
    'report_no_show',
    'report_reduced_hours',
    'dispute'
  ),
  reason: Schema.optional(Schema.NullOr(Schema.Literal(...sessionReasonCodes))),
  note: optionalText,
  minutesWorked: Schema.optional(Schema.NullOr(Schema.Int.pipe(Schema.nonNegative())))
});
export type SessionActionInput = Schema.Schema.Type<typeof sessionActionSchema>;
export const validateSessionActionInput = validateInput(
  sessionActionSchema,
  sessionActionValidationError
);

export const sessionResponseValidationError = {
  code: 'INVALID_SESSION_RESPONSE',
  message: 'Answer with accept, contest or decline.'
} as const;

export const sessionResponseSchema = Schema.Struct({
  response: Schema.Literal('accept', 'contest', 'decline'),
  note: optionalText
});
export type SessionResponseInput = Schema.Schema.Type<typeof sessionResponseSchema>;
export const validateSessionResponseInput = validateInput(
  sessionResponseSchema,
  sessionResponseValidationError
);

// ---------------------------------------------------------------------------
// Views

const blank = (value: string | null | undefined) =>
  value === undefined || value === null || value.trim() === '' ? null : value.trim();

const partyOf = (contract: Contract, userId: string): PartySide | null =>
  contract.familyUserId === userId
    ? 'family'
    : contract.providerUserId === userId
      ? 'helper'
      : null;

/** One resolution as a party sees it. */
export const resolutionView = (
  resolution: SessionResolution,
  viewerUserId: string,
  session: Pick<SessionRecord, 'date' | 'startMinutes'>,
  zone: string,
  policy: Pick<ResolutionPolicy, 'cancellationNoticeHours'>
) => ({
  id: resolution.id,
  kind: resolution.kind,
  status: resolution.status,
  reportedBySide: resolution.reportedBySide,
  reportedByMe: resolution.reportedByUserId === viewerUserId,
  recordedAt: resolution.recordedAt.toISOString(),
  reason: resolution.reason as (typeof sessionReasonCodes)[number] | null,
  note: resolution.note,
  minutesWorked: resolution.minutesWorked,
  respondBy: resolution.respondBy?.toISOString() ?? null,
  response: resolution.response,
  respondedByMe:
    resolution.respondedByUserId === null ? null : resolution.respondedByUserId === viewerUserId,
  respondedAt: resolution.respondedAt?.toISOString() ?? null,
  responseNote: resolution.responseNote,
  decision: resolution.decision,
  decisionReason: resolution.decisionReason,
  decidedAt: resolution.decidedAt?.toISOString() ?? null,
  /** A day off counts as the proposer's cancellation (spec §3a) — while it
   * is proposed or agreed; a lapsed or declined one counts as nothing. */
  countsAs:
    resolution.kind === 'day_off_agreed' &&
    resolution.status !== 'lapsed' &&
    resolution.status !== 'reversed'
      ? dayOffClassification(resolution, session, zone, policy)
      : null,
  policyVersion: resolution.policyVersion
});

export type ResolutionView = ReturnType<typeof resolutionView>;

/** The settings the UI copy needs (never hard-coded in the web). */
export const sessionWindowView = (policy: ResolutionPolicy) => ({
  windowDays: policy.windowDays,
  cancellationNoticeHours: policy.cancellationNoticeHours,
  reportResponseHours: policy.reportResponseHours,
  reportWindowHours: policy.reportWindowHours
});

/**
 * The cycle page's per-session part: each session's resolution (the active
 * one, else the latest that lapsed or was reversed), the actions the viewer
 * may take now, how they may answer, and what cancelling now would count as.
 * `canAct` is false without the session-resolution permission.
 */
export const cycleSessionResolutions = (input: {
  contract: Contract;
  viewerUserId: string;
  sessions: ReadonlyArray<SessionRecord>;
  zone: string;
  now: Date;
  canAct: boolean;
}) =>
  Effect.gen(function* () {
    const policy = yield* sessionResolutionPolicy;
    const side = partyOf(input.contract, input.viewerUserId);
    const all = yield* SessionResolutionRepo.pipe(
      Effect.flatMap((repo) => repo.listForContract(input.contract.id)),
      (errors) => mapSessionRepoError(errors)
    );
    const bySession = new Map<string, Array<SessionResolution>>();
    for (const row of all) {
      bySession.set(row.sessionId, [...(bySession.get(row.sessionId) ?? []), row]);
    }
    const perSession = new Map(
      input.sessions.map((session) => {
        const rows = bySession.get(session.id) ?? [];
        const active = rows.find((row) => activeResolutionStatuses.includes(row.status)) ?? null;
        const shown = active ?? rows.at(-1) ?? null;
        const ctx = { session, zone: input.zone, now: input.now, policy, active };
        const offered =
          input.canAct && side !== null
            ? availableSessionActions({ ...ctx, side })
            : { actions: [], responses: [] };
        return [
          session.id,
          {
            resolution: shown
              ? resolutionView(shown, input.viewerUserId, session, input.zone, policy)
              : null,
            actions: offered.actions,
            responses: offered.responses,
            cancelOutcome:
              side !== null && offered.actions.includes('cancel')
                ? plannedResolution('cancel', { ...ctx, side }).kind
                : null,
            cutoffAt: cancellationCutoff(
              session,
              input.zone,
              policy.cancellationNoticeHours
            ).toISOString()
          }
        ] as const;
      })
    );
    return { policy, sessionWindow: sessionWindowView(policy), perSession };
  });

// ---------------------------------------------------------------------------
// Loading

export const loadSessionContext = (viewerUserId: string, contractId: string, sessionId: string) =>
  Effect.gen(function* () {
    const contract = yield* ContractRepo.pipe(
      Effect.flatMap((repo) => repo.findById(contractId)),
      (errors) => mapSessionRepoError(errors)
    );
    const side = contract ? partyOf(contract, viewerUserId) : null;
    if (!contract || side === null) return yield* Effect.fail(new SessionNotFoundError());
    const billingRepo = yield* ContractBillingRepo;
    const billing = yield* billingRepo
      .findBilling(contractId)
      .pipe((errors) => mapSessionRepoError(errors));
    if (!billing) return yield* Effect.fail(new SessionNotFoundError());
    const session = (yield* billingRepo
      .listSessions(contractId)
      .pipe((errors) => mapSessionRepoError(errors))).find((row) => row.id === sessionId);
    if (!session) return yield* Effect.fail(new SessionNotFoundError());
    const active = yield* SessionResolutionRepo.pipe(
      Effect.flatMap((repo) => repo.findActiveForSession(session.id)),
      (errors) => mapSessionRepoError(errors)
    );
    const policy = yield* sessionResolutionPolicy;
    return { contract, billing, session, side, active, policy, zone: billing.timeZone };
  });

/**
 * The cancellation policy in force for this contract: the Terms of Service
 * revision the latest live agreement signature references, else the one
 * published now. Null when none was ever published.
 */
export const resolvePolicyVersion = (contractId: string) =>
  Effect.gen(function* () {
    const signatures = yield* ContractAgreementRepo.pipe(
      Effect.flatMap((repo) => repo.listForContract(contractId)),
      (errors) => mapSessionRepoError(errors)
    );
    const signed = signatures
      .filter((row) => row.voidedAt === null && row.cancellationPolicyVersionId !== null)
      .sort((a, b) => b.signedAt.getTime() - a.signedAt.getTime())[0];
    if (signed?.cancellationPolicyVersionId && signed.cancellationPolicyVersion !== null) {
      return { id: signed.cancellationPolicyVersionId, version: signed.cancellationPolicyVersion };
    }
    const current = yield* loadCancellationPolicy.pipe(
      Effect.catchTag('AgreementRepoError', (error) =>
        Effect.fail(new SessionRepoError({ cause: error.cause }))
      )
    );
    return current ? { id: current.version.id, version: current.version.version } : null;
  });

// ---------------------------------------------------------------------------
// Programs

const sessionFacts = (
  ctx: Effect.Effect.Success<ReturnType<typeof loadSessionContext>>,
  now: Date
) => ({
  session: ctx.session,
  zone: ctx.zone,
  now,
  policy: ctx.policy,
  side: ctx.side,
  active: ctx.active
});

/** Records one action on a session (see the module comment). */
export const recordSessionActionProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  sessionId: string,
  input: SessionActionInput,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const ctx = yield* loadSessionContext(viewer.id, contractId, sessionId);
    const facts = sessionFacts(ctx, now);
    const refusal = checkSessionAction(input.action, facts);
    if (refusal) return yield* refuse(refusal);
    const repo = yield* SessionResolutionRepo;
    const note = blank(input.note);
    const reason = input.reason ?? null;

    if (input.action === 'dispute' && ctx.active) {
      // Contest the other side's resolution: it goes to the admin queue.
      const moved = yield* repo
        .advance(
          ctx.active.id,
          {
            from: ['confirmed'],
            set: {
              status: 'contested',
              response: 'contested',
              respondedByUserId: viewer.id,
              respondedAt: now,
              responseNote: note
            }
          },
          { actorUserId: viewer.id, actorSide: ctx.side, action: 'disputed', note }
        )
        .pipe((errors) => mapSessionRepoError(errors));
      if (!moved) return yield* refuse('not_disputable');
      yield* noticeFor(moved, 'contested');
      // Tier 3 step 2: the session's money follows at once (best-effort;
      // the tick applies it otherwise).
      yield* reconcileSession(contractId, ctx.session.id, now);
      return { resolution: resolutionView(moved, viewer.id, ctx.session, ctx.zone, ctx.policy) };
    }

    if (input.action === 'report_reduced_hours') {
      const minutes = input.minutesWorked ?? null;
      if (minutes === null || minutes >= ctx.session.elapsedMinutes) {
        return yield* refuse('invalid_minutes');
      }
    }

    const planned = plannedResolution(
      input.action === 'dispute' ? 'dispute_new' : input.action,
      facts
    );
    const policyVersion = yield* resolvePolicyVersion(contractId);
    const row = yield* repo
      .record(
        {
          contractId,
          sessionId: ctx.session.id,
          cycleId: ctx.session.cycleId,
          kind: planned.kind,
          reportedByUserId: viewer.id,
          reportedBySide: ctx.side,
          recordedAt: now,
          reason,
          note,
          minutesWorked:
            input.action === 'report_reduced_hours' ? (input.minutesWorked ?? null) : null,
          status: planned.status,
          respondBy: planned.respondBy,
          policyVersionId: policyVersion?.id ?? null,
          policyVersion: policyVersion?.version ?? null
        },
        { actorUserId: viewer.id, actorSide: ctx.side, action: 'recorded', note }
      )
      .pipe((errors) => mapSessionRepoError(errors));
    // Lost the one-active-resolution race (a double click, two tabs).
    if (!row) return yield* refuse('already_resolved');
    yield* noticeFor(row, 'recorded');
    // Tier 3 step 2: the session's money follows at once (best-effort).
    yield* reconcileSession(contractId, ctx.session.id, now);
    return { resolution: resolutionView(row, viewer.id, ctx.session, ctx.zone, ctx.policy) };
  });

const responseOutcome: Record<
  ResolutionResponse,
  {
    status: SessionResolution['status'];
    response: NonNullable<SessionResolution['response']>;
    action: string;
    event: 'confirmed' | 'contested' | 'declined';
  }
> = {
  accept: { status: 'confirmed', response: 'accepted', action: 'accepted', event: 'confirmed' },
  contest: { status: 'contested', response: 'contested', action: 'contested', event: 'contested' },
  // A declined day off: the proposal is withdrawn, the session goes ahead.
  decline: { status: 'reversed', response: 'declined', action: 'declined', event: 'declined' }
};

/** The other side answers a one-sided report or a day-off proposal. */
export const respondToSessionProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  sessionId: string,
  input: SessionResponseInput,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const ctx = yield* loadSessionContext(viewer.id, contractId, sessionId);
    const refusal = checkResponse(input.response, sessionFacts(ctx, now));
    if (refusal) return yield* refuse(refusal);
    const outcome = responseOutcome[input.response];
    const note = blank(input.note);
    const moved = yield* SessionResolutionRepo.pipe(
      Effect.flatMap((repo) =>
        repo.advance(
          ctx.active!.id,
          {
            from: ['proposed'],
            set: {
              status: outcome.status,
              response: outcome.response,
              respondedByUserId: viewer.id,
              respondedAt: now,
              responseNote: note
            }
          },
          { actorUserId: viewer.id, actorSide: ctx.side, action: outcome.action, note }
        )
      ),
      (errors) => mapSessionRepoError(errors)
    );
    // The worker confirmed or lapsed it a moment ago.
    if (!moved) return yield* refuse('response_window_closed');
    yield* noticeFor(moved, outcome.event);
    // Tier 3 step 2: the session's money follows at once (best-effort).
    yield* reconcileSession(contractId, ctx.session.id, now);
    return { resolution: resolutionView(moved, viewer.id, ctx.session, ctx.zone, ctx.policy) };
  });

/** What on this contract is waiting for the viewer's answer (the contract
 * page lists it with a badge). */
export const listPendingSessionResponsesProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const contract = yield* ContractRepo.pipe(
      Effect.flatMap((repo) => repo.findById(contractId)),
      (errors) => mapSessionRepoError(errors)
    );
    const side = contract ? partyOf(contract, viewer.id) : null;
    if (!contract || side === null) return yield* Effect.fail(new SessionNotFoundError());
    const billingRepo = yield* ContractBillingRepo;
    const billing = yield* billingRepo
      .findBilling(contractId)
      .pipe((errors) => mapSessionRepoError(errors));
    if (!billing) return { items: [] };
    const policy = yield* sessionResolutionPolicy;
    const waiting = (yield* SessionResolutionRepo.pipe(
      Effect.flatMap((repo) => repo.listForContract(contractId)),
      (errors) => mapSessionRepoError(errors)
    )).filter(
      (row) =>
        row.status === 'proposed' &&
        row.reportedBySide !== side &&
        (row.respondBy === null || row.respondBy > now)
    );
    if (waiting.length === 0) return { items: [] };
    const sessions = new Map(
      (yield* billingRepo
        .listSessions(contractId)
        .pipe((errors) => mapSessionRepoError(errors))).map((row) => [row.id, row])
    );
    return {
      items: waiting.flatMap((row) => {
        const session = sessions.get(row.sessionId);
        if (!session) return [];
        return [
          {
            cycleId: row.cycleId,
            session: {
              id: session.id,
              date: session.date,
              serviceName: session.serviceName,
              startMinutes: session.startMinutes,
              endMinutes: session.endMinutes
            },
            resolution: resolutionView(row, viewer.id, session, billing.timeZone, policy)
          }
        ];
      })
    };
  });

// ---------------------------------------------------------------------------
// Route programs

const ids = (c: HonoContext<HonoEnv>) =>
  Effect.all({
    contractId: validateContractId(c.req.param('id')),
    sessionId: validateContractId(c.req.param('sessionId'))
  });

export const recordSessionActionRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const { contractId, sessionId } = yield* ids(c);
    const body = yield* parseJsonBody(c, sessionActionValidationError);
    const input = yield* validateSessionActionInput(body);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { sessionResolution: ['write'] })(
      authenticated
    );
    return yield* recordSessionActionProgram(userAndSession, contractId, sessionId, input, now);
  });

export const respondToSessionRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const { contractId, sessionId } = yield* ids(c);
    const body = yield* parseJsonBody(c, sessionResponseValidationError);
    const input = yield* validateSessionResponseInput(body);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { sessionResolution: ['write'] })(
      authenticated
    );
    return yield* respondToSessionProgram(userAndSession, contractId, sessionId, input, now);
  });

export const listPendingSessionResponsesRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { sessionResolution: ['read'] })(
      authenticated
    );
    return yield* listPendingSessionResponsesProgram(userAndSession, contractId, now);
  });
