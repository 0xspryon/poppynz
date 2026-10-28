/**
 * The admin dispute queue (Tier 3, step 1 — spec 2026-10-28 §10):
 *
 *   GET  /admin/session-disputes               contested resolutions
 *   GET  /admin/session-disputes/:id           one, with both statements, the
 *                                              session, the messages from 24 h
 *                                              before to 24 h after it, the
 *                                              signed agreement snapshot and
 *                                              the policy version
 *   POST /admin/session-disputes/:id/decide    outcome + required reason
 *
 * Gated by the `sessionDispute` permission (granted to admins), never by a
 * role. Every decision is a compare-and-set that writes its audit row (who,
 * when, before and after) in the same transaction, then tells both parties.
 * Step 1 records the decision only; step 2 applies its money.
 */
import type { SqlError } from '@effect/sql/SqlError';
import { noticeFor } from '@repo/billing';
import { zoneLabel } from '@repo/calendar';
import {
  ContractAgreementRepo,
  ContractBillingRepo,
  ContractRepo,
  SessionResolutionRepo,
  UserProfileRepo,
  UserRepo,
  sessionResolutionDecisions,
  type SessionResolution
} from '@repo/db';
import { Cause, Data, Effect, Exit, Option, Schema } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions,
  type UserAndSession
} from '@/api/lib/effect-auth';
import {
  parseJsonBody,
  requestValidationErrorToResponse,
  validateInput
} from '@/api/lib/schema-validator';

export class SessionDisputeRepoError extends Data.TaggedError('SessionDisputeRepoError')<{
  cause: SqlError;
}> {}

export class SessionDisputeNotFoundError extends Data.TaggedError(
  'SessionDisputeNotFoundError'
)<{}> {}

/** Only a contested resolution can be decided (already decided, or never
 * contested). */
export class SessionDisputeNotOpenError extends Data.TaggedError(
  'SessionDisputeNotOpenError'
)<{}> {}

/** Deciding "reduced hours" needs the minutes worked (below the session's). */
export class SessionDisputeMinutesError extends Data.TaggedError('SessionDisputeMinutesError')<{
  elapsedMinutes: number;
}> {}

const mapRepoError = <A, R>(effect: Effect.Effect<A, SqlError, R>) =>
  effect.pipe(
    Effect.catchTag('SqlError', (cause) => Effect.fail(new SessionDisputeRepoError({ cause })))
  );

const DAY_MS = 24 * 60 * 60 * 1000;

export const decideValidationError = {
  code: 'INVALID_SESSION_DECISION',
  message: 'Choose an outcome and give a reason.'
} as const;

export const decideSchema = Schema.Struct({
  decision: Schema.Literal(...sessionResolutionDecisions),
  reason: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  minutesWorked: Schema.optional(Schema.NullOr(Schema.Int.pipe(Schema.nonNegative())))
});
export type DecideInput = Schema.Schema.Type<typeof decideSchema>;
const validateDecideInput = validateInput(decideSchema, decideValidationError);

const idValidationError = {
  code: 'INVALID_SESSION_DISPUTE_ID',
  message: 'A valid dispute id is required.'
} as const;
const validateDisputeId = validateInput(Schema.UUID, idValidationError);

/** "Priya Tester" — admins see full names. */
const fullName = (userId: string) =>
  Effect.gen(function* () {
    const profile = yield* UserProfileRepo.pipe(
      Effect.flatMap((repo) => repo.findByUserId(userId)),
      Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)),
      (errors) => mapRepoError(errors)
    );
    const named = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
    if (named) return named;
    const user = yield* UserRepo.pipe(
      Effect.flatMap((repo) => repo.findById(userId)),
      Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)),
      (errors) => mapRepoError(errors)
    );
    return user?.name ?? 'Poppynz member';
  });

/** The resolution with its contract, billing and session. `otherUserIds`:
 * anyone else to name (the deciding admin, audit actors). */
const loadDispute = (resolution: SessionResolution, otherUserIds: ReadonlyArray<string> = []) =>
  Effect.gen(function* () {
    const contract = yield* ContractRepo.pipe(
      Effect.flatMap((repo) => repo.findById(resolution.contractId)),
      (errors) => mapRepoError(errors)
    );
    const billingRepo = yield* ContractBillingRepo;
    const billing = yield* billingRepo
      .findBilling(resolution.contractId)
      .pipe((errors) => mapRepoError(errors));
    const session = (yield* billingRepo
      .listSessions(resolution.contractId, resolution.cycleId)
      .pipe((errors) => mapRepoError(errors))).find((row) => row.id === resolution.sessionId);
    if (!contract || !billing || !session) {
      return yield* Effect.fail(new SessionDisputeNotFoundError());
    }
    const family = yield* fullName(contract.familyUserId);
    const helper = yield* fullName(contract.providerUserId);
    const others = new Map<string, string>();
    for (const userId of new Set([resolution.decidedByUserId, ...otherUserIds])) {
      if (userId === null || userId === contract.familyUserId) continue;
      if (userId === contract.providerUserId) continue;
      others.set(userId, yield* fullName(userId));
    }
    const nameOf = (userId: string | null) =>
      userId === null
        ? null
        : userId === contract.familyUserId
          ? family
          : userId === contract.providerUserId
            ? helper
            : (others.get(userId) ?? 'Poppynz');
    return { contract, billing, session, family, helper, nameOf };
  });

const sessionView = (
  session: Effect.Effect.Success<ReturnType<typeof loadDispute>>['session'],
  zone: string
) => ({
  id: session.id,
  cycleId: session.cycleId,
  date: session.date,
  serviceName: session.serviceName,
  startMinutes: session.startMinutes,
  endMinutes: session.endMinutes,
  elapsedMinutes: session.elapsedMinutes,
  startsAt: session.startsAt.toISOString(),
  endsAt: session.endsAt.toISOString(),
  timeZone: zone,
  timeZoneLabel: zoneLabel(zone)
});

const resolutionSummary = (
  resolution: SessionResolution,
  nameOf: (userId: string | null) => string | null
) => ({
  id: resolution.id,
  kind: resolution.kind,
  status: resolution.status,
  reportedBySide: resolution.reportedBySide,
  reportedByName: nameOf(resolution.reportedByUserId),
  recordedAt: resolution.recordedAt.toISOString(),
  reason: resolution.reason,
  note: resolution.note,
  minutesWorked: resolution.minutesWorked,
  respondBy: resolution.respondBy?.toISOString() ?? null,
  response: resolution.response,
  respondedByName: nameOf(resolution.respondedByUserId),
  respondedAt: resolution.respondedAt?.toISOString() ?? null,
  responseNote: resolution.responseNote,
  decision: resolution.decision,
  decisionReason: resolution.decisionReason,
  decisionMinutesWorked: resolution.decisionMinutesWorked,
  decidedByName: nameOf(resolution.decidedByUserId),
  decidedAt: resolution.decidedAt?.toISOString() ?? null,
  policyVersion: resolution.policyVersion,
  updatedAt: resolution.updatedAt.toISOString()
});

// ---------------------------------------------------------------------------
// Programs

export const listSessionDisputesProgram = (status: 'contested' | 'decided' = 'contested') =>
  Effect.gen(function* () {
    const rows = yield* SessionResolutionRepo.pipe(
      Effect.flatMap((repo) => repo.listByStatus([status])),
      (errors) => mapRepoError(errors)
    );
    const items = [];
    for (const row of rows) {
      const loaded = yield* loadDispute(row).pipe(
        Effect.catchTag('SessionDisputeNotFoundError', () => Effect.succeed(null))
      );
      if (!loaded) continue;
      items.push({
        ...resolutionSummary(row, loaded.nameOf),
        contractId: row.contractId,
        familyName: loaded.family,
        helperName: loaded.helper,
        session: sessionView(loaded.session, loaded.billing.timeZone)
      });
    }
    return { disputes: items };
  });

export const getSessionDisputeProgram = (id: string) =>
  Effect.gen(function* () {
    const repo = yield* SessionResolutionRepo;
    const resolution = yield* repo.findById(id).pipe((errors) => mapRepoError(errors));
    if (!resolution) return yield* Effect.fail(new SessionDisputeNotFoundError());
    const events = yield* repo.listEvents(id).pipe((errors) => mapRepoError(errors));
    const { contract, billing, session, family, helper, nameOf } = yield* loadDispute(
      resolution,
      events.flatMap((event) => (event.actorUserId === null ? [] : [event.actorUserId]))
    );
    const messages = yield* repo
      .listMessagesBetween(
        contract.conversationId,
        new Date(session.startsAt.getTime() - DAY_MS),
        new Date(session.endsAt.getTime() + DAY_MS)
      )
      .pipe((errors) => mapRepoError(errors));
    const signatures = (yield* ContractAgreementRepo.pipe(
      Effect.flatMap((agreements) => agreements.listForContract(contract.id)),
      (errors) => mapRepoError(errors)
    )).filter(
      (row) => row.voidedAt === null && row.contractVersionId === billing.acceptedVersionId
    );
    return {
      dispute: {
        ...resolutionSummary(resolution, nameOf),
        contractId: contract.id,
        familyName: family,
        helperName: helper,
        session: sessionView(session, billing.timeZone),
        messages: messages.map((message) => ({
          id: message.id,
          side:
            message.senderUserId === contract.familyUserId
              ? ('family' as const)
              : message.senderUserId === contract.providerUserId
                ? ('helper' as const)
                : ('other' as const),
          senderName: nameOf(message.senderUserId),
          body: message.body,
          sentAt: message.createdAt.toISOString()
        })),
        agreement: signatures.map((signature) => ({
          id: signature.id,
          side: signature.signerSide,
          signerName: nameOf(signature.signerUserId),
          contractVersion: signature.contractVersion,
          templateVersion: signature.templateVersion,
          locale: signature.locale,
          sha256: signature.contentSha256,
          cancellationPolicyVersion: signature.cancellationPolicyVersion,
          signedAt: signature.signedAt.toISOString(),
          content: signature.content
        })),
        history: events.map((event) => ({
          id: event.id,
          action: event.action,
          actorSide: event.actorSide,
          actorName: nameOf(event.actorUserId),
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          note: event.note,
          at: event.createdAt.toISOString()
        }))
      }
    };
  });

export const decideSessionDisputeProgram = (
  admin: UserAndSession,
  id: string,
  input: DecideInput,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const repo = yield* SessionResolutionRepo;
    const resolution = yield* repo.findById(id).pipe((errors) => mapRepoError(errors));
    if (!resolution) return yield* Effect.fail(new SessionDisputeNotFoundError());
    if (resolution.status !== 'contested') {
      return yield* Effect.fail(new SessionDisputeNotOpenError());
    }
    const { session } = yield* loadDispute(resolution);
    const minutes =
      input.decision === 'family_reduced_hours' ? (input.minutesWorked ?? null) : null;
    if (
      input.decision === 'family_reduced_hours' &&
      (minutes === null || minutes >= session.elapsedMinutes)
    ) {
      return yield* Effect.fail(
        new SessionDisputeMinutesError({ elapsedMinutes: session.elapsedMinutes })
      );
    }
    const decided = yield* repo
      .advance(
        id,
        {
          from: ['contested'],
          set: {
            status: 'decided',
            decision: input.decision,
            decisionReason: input.reason,
            decisionMinutesWorked: minutes,
            decidedByUserId: admin.user.id,
            decidedAt: now
          }
        },
        { actorUserId: admin.user.id, actorSide: 'admin', action: 'decided', note: input.reason }
      )
      .pipe((errors) => mapRepoError(errors));
    // Another admin decided it a moment ago.
    if (!decided) return yield* Effect.fail(new SessionDisputeNotOpenError());
    yield* noticeFor(decided, 'decided');
    return { id: decided.id, status: decided.status, decision: decided.decision };
  });

// ---------------------------------------------------------------------------
// Route programs

export const listSessionDisputesRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { sessionDispute: ['read'] })(authenticated);
    return yield* listSessionDisputesProgram(
      c.req.query('status') === 'decided' ? 'decided' : 'contested'
    );
  });

export const getSessionDisputeRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const id = yield* validateDisputeId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { sessionDispute: ['read'] })(authenticated);
    return yield* getSessionDisputeProgram(id);
  });

export const decideSessionDisputeRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const id = yield* validateDisputeId(c.req.param('id'));
    const body = yield* parseJsonBody(c, decideValidationError);
    const input = yield* validateDecideInput(body);
    const authenticated = yield* authenticate(headers);
    const admin = yield* requirePermissions(headers, { sessionDispute: ['read', 'decide'] })(
      authenticated
    );
    return yield* decideSessionDisputeProgram(admin, id, input, now);
  });

type SessionDisputeRouteError =
  | Effect.Effect.Error<ReturnType<typeof listSessionDisputesRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getSessionDisputeRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof decideSessionDisputeRouteProgram>>;

const errorToResponse = (c: HonoContext<HonoEnv>, error: SessionDisputeRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'SessionDisputeNotFoundError':
      return c.json(
        { error: { code: 'SESSION_DISPUTE_NOT_FOUND' as const, message: 'Dispute not found.' } },
        404
      );
    case 'SessionDisputeNotOpenError':
      return c.json(
        {
          error: {
            code: 'SESSION_DISPUTE_NOT_OPEN' as const,
            message: 'This dispute is not open (already decided?).'
          }
        },
        409
      );
    case 'SessionDisputeMinutesError':
      return c.json(
        {
          error: {
            code: 'SESSION_DISPUTE_MINUTES_REQUIRED' as const,
            message: `Reduced hours need the minutes worked (below ${error.elapsedMinutes}).`
          }
        },
        422
      );
    case 'SessionDisputeRepoError':
      return c.json(
        {
          error: {
            code: 'SESSION_DISPUTE_LOOKUP_FAILED' as const,
            message: 'Unable to process the dispute.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, SessionDisputeRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return errorToResponse(c, failure.value);
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function listSessionDisputesHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(listSessionDisputesRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function getSessionDisputeHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(getSessionDisputeRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function decideSessionDisputeHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(decideSessionDisputeRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}
