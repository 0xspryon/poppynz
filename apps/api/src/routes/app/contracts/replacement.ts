/**
 * Replacement from a template (Tier 3, step 1b — spec 2026-10-28 §1, §3a).
 *
 * When a helper cancels a session, the family can find another helper for
 * it: Find help opens filtered by the session's service (the helper who
 * cancelled left out), and choosing a helper starts a short DRAFT contract
 * in the family's conversation with them, pre-filled from the contract the
 * cancelled session belongs to — the same service and expectations, the
 * cancelled sessions' days and times between the first and the last
 * cancelled date, at the new helper's listed rate for that service (never
 * below the offer floor).
 *
 * Nothing here bypasses the usual rules: without an unlocked conversation
 * the family goes through the normal reach-out first (REPLACEMENT_REACH_OUT_
 * REQUIRED), and the draft is edited, signed and sent like any other — every
 * send-time check (card on file, lead time, floor, publishability, the
 * written agreement) still applies. The replacement link is stored with the
 * draft (`contract_replacements`) for later steps and admins.
 */
import { planSessions } from '@repo/billing';
import { weekdayOf } from '@repo/calendar';
import {
  ContractBillingRepo,
  ContractRepo,
  ContractReplacementRepo,
  ConversationRepo,
  ServiceOfferedRepo,
  SessionResolutionRepo,
  activeResolutionStatuses,
  offerFloorCents,
  type Contract,
  type ContractServiceItem,
  type ContractSession,
  type PublishableService,
  type ServiceOffered,
  type SessionRecord,
  type SessionResolution
} from '@repo/db';
import { Data, Effect, Schema } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { authenticate, requirePermissions, type UserAndSession } from '@/api/lib/effect-auth';
import { requireLiveApproval } from '@/api/lib/approval-gate';
import { requireVerifiedSafety } from '@/api/lib/safety-verification-gate';
import { parseJsonBody, validateInput } from '@/api/lib/schema-validator';
import {
  ContractExistsError,
  ContractRepoError,
  ContractStateError,
  NotContractActorError,
  displayName,
  isUniqueViolation,
  loadParticipantContract,
  mapContractRepoError,
  negotiatingStatuses
} from './contracts.handler';
import { validateContractId } from './contracts.validator';
import { isHelperCancellation } from './sessions';

// ---------------------------------------------------------------------------
// Errors

/** The sessions named can't be replaced: one isn't on this contract, the
 * helper didn't cancel it, it has already started, they mix services, or no
 * single short contract books exactly them (`not_one_stretch`: its weekly
 * pattern would also book sessions in between that weren't cancelled). */
export class ReplacementSessionsInvalidError extends Data.TaggedError(
  'ReplacementSessionsInvalidError'
)<{
  reason:
    | 'unknown_session'
    | 'not_cancelled_by_helper'
    | 'already_started'
    | 'mixed_services'
    | 'not_one_stretch';
}> {}

/** The helper who cancelled can't be their own replacement. */
export class ReplacementSameHelperError extends Data.TaggedError(
  'ReplacementSameHelperError'
)<{}> {}

/** No unlocked conversation with the chosen helper yet: reach out first
 * (`status: 'none'`), wait for them to accept (`pending`), or pick someone
 * else (`ignored`). The replacement never skips the reach-out rules. */
export class ReplacementReachOutRequiredError extends Data.TaggedError(
  'ReplacementReachOutRequiredError'
)<{ status: 'none' | 'pending' | 'ignored'; conversationId: string | null }> {}

/** The chosen helper doesn't list the cancelled session's service. */
export class ReplacementServiceNotOfferedError extends Data.TaggedError(
  'ReplacementServiceNotOfferedError'
)<{}> {}

/** The chosen helper lists the service but families can't book it yet (a
 * custom service awaiting review, a missing or expired credential). */
export class ReplacementServiceNotPublishableError extends Data.TaggedError(
  'ReplacementServiceNotPublishableError'
)<{}> {}

// ---------------------------------------------------------------------------
// Input

export const replacementCreateValidationError = {
  code: 'INVALID_REPLACEMENT_INPUT',
  message: 'Choose a helper and at least one cancelled session.'
} as const;

/** More than this many sessions in one replacement is not a "short" one. */
export const MAX_REPLACEMENT_SESSIONS = 50;

const sessionIdsSchema = Schema.Array(Schema.UUID).pipe(
  Schema.minItems(1),
  Schema.maxItems(MAX_REPLACEMENT_SESSIONS)
);

export const replacementCreateSchema = Schema.Struct({
  providerUserId: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(200)),
  sessionIds: sessionIdsSchema
});
export type ReplacementCreateInput = Schema.Schema.Type<typeof replacementCreateSchema>;
export const validateReplacementCreateInput = validateInput(
  replacementCreateSchema,
  replacementCreateValidationError
);

export const replacementContextValidationError = {
  code: 'INVALID_REPLACEMENT_SESSIONS',
  message: 'The sessions must be a comma-separated list of session ids.'
} as const;
const validateSessionIdsQuery = validateInput(sessionIdsSchema, replacementContextValidationError);

/** `?sessions=a,b` (absent: every replaceable session). */
export const parseSessionIdsQuery = (raw: string | undefined) =>
  raw === undefined || raw.trim() === ''
    ? Effect.succeed(null)
    : validateSessionIdsQuery(
        raw
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      );

// ---------------------------------------------------------------------------
// Pure parts

/** Sorted, de-duplicated ids: a replacement's identity for idempotency. */
export const sessionKey = (ids: ReadonlyArray<string>) => Array.from(new Set(ids)).sort();

const sameIds = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
  const left = sessionKey(a);
  const right = sessionKey(b);
  return left.length === right.length && left.every((id, index) => id === right[index]);
};

/**
 * The cancelled sessions as short contract terms: the weekly pattern of
 * their days and times, starting on the first cancelled date and ending on
 * the last. The last day is cut at its last cancelled session's end when the
 * pattern has later sessions on that weekday (otherwise the whole day runs).
 */
export const replacementSchedule = (
  sessions: ReadonlyArray<Pick<SessionRecord, 'date' | 'startMinutes' | 'endMinutes'>>
): {
  sessions: Array<ContractSession>;
  startsOn: string;
  endsOn: string;
  endsAtMinutes: number | null;
} => {
  const sorted = [...sessions].sort((a, b) =>
    a.date === b.date ? a.startMinutes - b.startMinutes : a.date < b.date ? -1 : 1
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const pattern = new Map<string, ContractSession>();
  for (const session of sorted) {
    const weekday = weekdayOf(session.date);
    pattern.set(`${weekday}@${session.startMinutes}-${session.endMinutes}`, {
      weekday,
      startMinutes: session.startMinutes,
      endMinutes: session.endMinutes
    });
  }
  const weekly = [...pattern.values()].sort((a, b) =>
    a.weekday === b.weekday ? a.startMinutes - b.startMinutes : a.weekday - b.weekday
  );
  const lastDayEnd = Math.max(
    ...sorted.filter((session) => session.date === last.date).map((session) => session.endMinutes)
  );
  const lastWeekday = weekdayOf(last.date);
  const patternEnd = Math.max(
    ...weekly.filter((session) => session.weekday === lastWeekday).map((s) => s.endMinutes)
  );
  return {
    sessions: weekly,
    startsOn: first.date,
    endsOn: last.date,
    endsAtMinutes: lastDayEnd < patternEnd ? lastDayEnd : null
  };
};

type SessionSlot = Pick<SessionRecord, 'date' | 'startMinutes' | 'endMinutes'>;

const slotKey = (slot: SessionSlot) => `${slot.date}@${slot.startMinutes}-${slot.endMinutes}`;

/**
 * Whether the short contract `replacementSchedule` makes from these
 * sessions books exactly them. A weekly pattern between two dates books
 * every occurrence in between — a Monday cancelled in week 1 and in week 3
 * would also book week 2's Monday, which the helper still works — and the
 * first day can't start part-way through, so such a set needs two contracts.
 */
export const coversExactly = (sessions: ReadonlyArray<SessionSlot>): boolean => {
  if (sessions.length === 0) return false;
  const schedule = replacementSchedule(sessions);
  const booked = planSessions(
    {
      services: [{ serviceId: 'replacement', name: '', rateCents: 0, sessions: schedule.sessions }],
      startsOn: schedule.startsOn,
      // Only dates and wall-clock minutes are compared: the zone is moot.
      timeZone: 'UTC',
      endsOn: schedule.endsOn,
      endsAtMinutes: schedule.endsAtMinutes
    },
    schedule.startsOn,
    schedule.endsOn
  )
    .map(slotKey)
    .sort();
  const wanted = Array.from(new Set(sessions.map(slotKey))).sort();
  return booked.length === wanted.length && booked.every((key, index) => key === wanted[index]);
};

/**
 * Splits cancelled sessions of one service, in time order, into the fewest
 * consecutive stretches that one short contract each books exactly.
 */
export const replacementStretches = <T extends SessionSlot>(
  sessions: ReadonlyArray<T>
): Array<Array<T>> => {
  const sorted = [...sessions].sort((a, b) =>
    a.date === b.date ? a.startMinutes - b.startMinutes : a.date < b.date ? -1 : 1
  );
  const stretches: Array<Array<T>> = [];
  for (const session of sorted) {
    const current = stretches[stretches.length - 1];
    if (current && coversExactly([...current, session])) current.push(session);
    else stretches.push([session]);
  }
  return stretches;
};

/** The new helper's matching service: the same catalogue service, else the
 * same name (custom services, or a catalogue link that is gone). */
export const matchingService = <T extends Pick<ServiceOffered, 'catalogueServiceId' | 'name'>>(
  candidates: ReadonlyArray<T>,
  wanted: { catalogueServiceId: string | null; name: string }
): T | null => {
  const name = wanted.name.trim().toLowerCase();
  return (
    candidates.find(
      (service) =>
        wanted.catalogueServiceId !== null &&
        service.catalogueServiceId === wanted.catalogueServiceId
    ) ??
    candidates.find((service) => service.name.trim().toLowerCase() === name) ??
    null
  );
};

/** The new helper's listed rate, never below the offer floor (base rate). */
export const replacementRateCents = (service: PublishableService) =>
  Math.max(service.hourlyRateCents, offerFloorCents(service));

// ---------------------------------------------------------------------------
// Loading

type CancelledSession = SessionRecord & { resolution: SessionResolution };

/**
 * The original contract as its family sees it, with the sessions the helper
 * cancelled that haven't started yet. Only the family may replace.
 */
const loadReplaceable = (userAndSession: UserAndSession, contractId: string, now: Date) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);
    if (contract.familyUserId !== viewer.id) {
      return yield* Effect.fail(new NotContractActorError());
    }
    const billingRepo = yield* ContractBillingRepo;
    const billing = yield* billingRepo
      .findBilling(contractId)
      .pipe((errors) => mapContractRepoError(errors));
    if (billing === null) return yield* Effect.fail(new ContractStateError());
    const sessions = yield* billingRepo
      .listSessions(contractId)
      .pipe((errors) => mapContractRepoError(errors));
    const resolutions = yield* SessionResolutionRepo.pipe(
      Effect.flatMap((repo) => repo.listForContract(contractId)),
      (errors) => mapContractRepoError(errors)
    );
    const activeBySession = new Map(
      resolutions
        .filter((row) => activeResolutionStatuses.includes(row.status))
        .map((row) => [row.sessionId, row])
    );
    const cancelled = new Map<string, CancelledSession>();
    for (const session of sessions) {
      const resolution = activeBySession.get(session.id);
      if (resolution && isHelperCancellation(resolution)) {
        cancelled.set(session.id, { ...session, resolution });
      }
    }
    const isUpcoming = (session: SessionRecord) => session.startsAt.getTime() > now.getTime();
    return { contract, billing, sessions, cancelled, isUpcoming };
  });

/** Picks the named sessions; every one must be a helper cancellation that
 * hasn't started, all for one service. */
const pickSessions = (
  loaded: Effect.Effect.Success<ReturnType<typeof loadReplaceable>>,
  sessionIds: ReadonlyArray<string>
) =>
  Effect.gen(function* () {
    const known = new Set(loaded.sessions.map((session) => session.id));
    const picked: Array<CancelledSession> = [];
    for (const id of sessionKey(sessionIds)) {
      if (!known.has(id)) {
        return yield* Effect.fail(
          new ReplacementSessionsInvalidError({ reason: 'unknown_session' })
        );
      }
      const session = loaded.cancelled.get(id);
      if (!session) {
        return yield* Effect.fail(
          new ReplacementSessionsInvalidError({ reason: 'not_cancelled_by_helper' })
        );
      }
      if (!loaded.isUpcoming(session)) {
        return yield* Effect.fail(
          new ReplacementSessionsInvalidError({ reason: 'already_started' })
        );
      }
      picked.push(session);
    }
    if (new Set(picked.map((session) => session.serviceId)).size > 1) {
      return yield* Effect.fail(new ReplacementSessionsInvalidError({ reason: 'mixed_services' }));
    }
    if (!coversExactly(picked)) {
      return yield* Effect.fail(new ReplacementSessionsInvalidError({ reason: 'not_one_stretch' }));
    }
    return picked;
  });

const helperName = (contract: Contract, viewerUserId: string) =>
  ContractRepo.pipe(
    Effect.flatMap((repo) => repo.findWithContext(contract.id, viewerUserId)),
    (errors) => mapContractRepoError(errors),
    Effect.map((row) =>
      displayName(
        row ? { firstName: row.counterpartFirstName, lastName: row.counterpartLastName } : null,
        'Poppynz member'
      )
    )
  );

// ---------------------------------------------------------------------------
// Programs

/**
 * What Find help shows in "Find a replacement" mode, and what the contract
 * page lists: the helper who cancelled (left out of the search) and the
 * cancelled sessions not yet started — the named ones, or all of them —
 * each with the replacement already started for it, if any.
 */
export const replacementContextProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  sessionIds: ReadonlyArray<string> | null,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const loaded = yield* loadReplaceable(userAndSession, contractId, now);
    const sessions =
      sessionIds === null
        ? [...loaded.cancelled.values()].filter(loaded.isUpcoming)
        : yield* pickSessions(loaded, sessionIds);
    const replacements = yield* ContractReplacementRepo.pipe(
      Effect.flatMap((repo) => repo.listByReplacedContract(contractId)),
      (errors) => mapContractRepoError(errors)
    );
    const replacementBySession = new Map(
      replacements.map((row) => [row.sessionId, row.contractId])
    );
    const name = yield* helperName(loaded.contract, userAndSession.user.id);
    // What "Find a replacement" searches for: the sessions not yet covered,
    // per service, in stretches that one short contract each books exactly.
    const sorted = [...sessions].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const byService = new Map<string, Array<CancelledSession>>();
    for (const session of sorted) {
      if (replacementBySession.has(session.id)) continue;
      byService.set(session.serviceId, [...(byService.get(session.serviceId) ?? []), session]);
    }
    const stretches = [...byService.values()]
      .flatMap((group) => replacementStretches(group))
      .sort((a, b) => a[0]!.startsAt.getTime() - b[0]!.startsAt.getTime())
      .map((stretch) => ({
        serviceName: stretch[0]!.serviceName,
        sessionIds: stretch.map((session) => session.id)
      }));
    return {
      replacement: {
        contractId,
        helper: { userId: loaded.contract.providerUserId, name },
        sessions: sorted.map((session) => ({
          id: session.id,
          cycleId: session.cycleId,
          date: session.date,
          serviceName: session.serviceName,
          startMinutes: session.startMinutes,
          endMinutes: session.endMinutes,
          replacementContractId: replacementBySession.get(session.id) ?? null
        })),
        stretches
      }
    };
  });

/**
 * "Use this contract as a template": a new DRAFT contract with another
 * helper in the family's conversation with them, pre-filled from the
 * original contract for the cancelled sessions (see the module comment).
 * Idempotent: the same replacement asked for twice (a double click, two
 * tabs) returns the same draft; any other contract under negotiation in that
 * conversation is CONTRACT_EXISTS, as for "start a new contract".
 */
export const createReplacementProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  input: ReplacementCreateInput,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const loaded = yield* loadReplaceable(userAndSession, contractId, now);
    const picked = yield* pickSessions(loaded, input.sessionIds);
    const sessionIds = picked.map((session) => session.id);
    const original = loaded.contract;
    if (input.providerUserId === original.providerUserId) {
      return yield* Effect.fail(new ReplacementSameHelperError());
    }

    // The reach-out rules stand: only an unlocked conversation can hold a
    // contract.
    const conversation = yield* ConversationRepo.pipe(
      Effect.flatMap((repo) => repo.findByPair(viewer.id, input.providerUserId)),
      (errors) => mapContractRepoError(errors)
    );
    if (!conversation || conversation.status !== 'active') {
      return yield* Effect.fail(
        new ReplacementReachOutRequiredError({
          status:
            conversation?.status === 'pending' || conversation?.status === 'ignored'
              ? conversation.status
              : 'none',
          conversationId: conversation?.id ?? null
        })
      );
    }

    // The same replacement already started: that draft (idempotent).
    // Anything else being negotiated there is where to go instead.
    const contractRepo = yield* ContractRepo;
    const replacementRepo = yield* ContractReplacementRepo;
    const openIn = (contracts: ReadonlyArray<Contract>) =>
      contracts.find((row) => negotiatingStatuses.includes(row.status)) ?? null;
    const existingOutcome = (open: Contract) =>
      replacementRepo.findForContract(open.id).pipe(
        (errors) => mapContractRepoError(errors),
        Effect.flatMap((link) =>
          link !== null &&
          link.replacesContractId === original.id &&
          sameIds(link.sessionIds, sessionIds)
            ? Effect.succeed({ id: open.id, reused: true as const })
            : Effect.fail(new ContractExistsError({ contractId: open.id }))
        )
      );
    const open = openIn(
      yield* contractRepo
        .listByConversationId(conversation.id)
        .pipe((errors) => mapContractRepoError(errors))
    );
    if (open) return yield* existingOutcome(open);

    // The new helper's own listing for the cancelled service.
    const serviceRepo = yield* ServiceOfferedRepo;
    const first = picked[0]!;
    const originalService = yield* serviceRepo
      .findByIdForUser(first.serviceId, original.providerUserId)
      .pipe(
        Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)),
        (errors) => mapContractRepoError(errors)
      );
    const wanted = {
      catalogueServiceId: originalService?.catalogueServiceId ?? null,
      name: first.serviceName
    };
    const [listed, publishable] = yield* Effect.all([
      serviceRepo.listByUserId(input.providerUserId),
      serviceRepo.listPublishableByUserIds([input.providerUserId])
    ]).pipe((errors) => mapContractRepoError(errors));
    const service = matchingService(publishable, wanted);
    if (!service) {
      return yield* Effect.fail(
        matchingService(listed, wanted)
          ? new ReplacementServiceNotPublishableError()
          : new ReplacementServiceNotOfferedError()
      );
    }

    // Same expectations as the terms in force on the original contract.
    const versions = yield* contractRepo
      .listVersions(original.id)
      .pipe((errors) => mapContractRepoError(errors));
    const accepted =
      versions.find((version) => version.id === loaded.billing.acceptedVersionId) ??
      versions.find((version) => version.status === 'accepted') ??
      null;
    if (accepted === null) return yield* Effect.fail(new ContractStateError());
    const expectations =
      accepted.services.find((item) => item.serviceId === first.serviceId)?.expectations ?? '';

    const schedule = replacementSchedule(picked);
    const item: ContractServiceItem = {
      serviceId: service.id,
      name: service.name,
      listedRateCents: service.hourlyRateCents,
      rateCents: replacementRateCents(service),
      currency: service.currency,
      sessions: schedule.sessions,
      expectations
    };

    const created = yield* replacementRepo
      .createDraft({
        conversationId: conversation.id,
        familyUserId: viewer.id,
        providerUserId: input.providerUserId,
        services: [item],
        startsOn: schedule.startsOn,
        endsOn: schedule.endsOn,
        endsAtMinutes: schedule.endsAtMinutes,
        replacesContractId: original.id,
        sessionIds
      })
      .pipe(
        // A double click races the negotiating-unique index: the loser gets
        // the winner's answer (the same draft, or CONTRACT_EXISTS).
        Effect.catchTag('SqlError', (cause) =>
          isUniqueViolation(cause)
            ? contractRepo.listByConversationId(conversation.id).pipe(
                (errors) => mapContractRepoError(errors),
                Effect.flatMap((rows) => {
                  const winner = openIn(rows);
                  return winner
                    ? existingOutcome(winner)
                    : Effect.fail(new ContractRepoError({ cause }));
                })
              )
            : Effect.fail(new ContractRepoError({ cause }))
        )
      );
    // No notification: a draft is family-private until it is sent.
    return 'reused' in created ? created : { id: created.contract.id, reused: false as const };
  });

// ---------------------------------------------------------------------------
// Route programs

export const replacementContextRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const sessionIds = yield* parseSessionIdsQuery(c.req.query('sessions'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['read'] })(
      authenticated
    );
    return yield* replacementContextProgram(userAndSession, contractId, sessionIds);
  });

export const createReplacementRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const body = yield* parseJsonBody(c, replacementCreateValidationError);
    const input = yield* validateReplacementCreateInput(body);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['write'] })(
      authenticated
    );
    // Starting a contract is the bookable act: the same gates as creating one.
    yield* requireVerifiedSafety(userAndSession);
    yield* requireLiveApproval(userAndSession);
    return yield* createReplacementProgram(userAndSession, contractId, input);
  });
