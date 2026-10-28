/**
 * Extra sessions (Tier 3 step 3, spec 2026-10-28 §1 step 3, §12 decisions 4
 * and 5; UAT item 12):
 *
 *   GET  /contracts/:id/extra-sessions[?cycleId=]          the contract's extra
 *                                                           sessions (or one
 *                                                           cycle's) and what
 *                                                           the viewer may do
 *   POST /contracts/:id/extra-sessions/quote               price a slot
 *   POST /contracts/:id/extra-sessions                     propose one
 *   POST /contracts/:id/extra-sessions/:extraId/respond    accept / decline
 *   POST /contracts/:id/extra-sessions/:extraId/withdraw   the proposer takes
 *                                                           it back
 *   POST /contracts/:id/extra-sessions/:extraId/cancel     either side, during
 *                                                           the charge delay
 *
 * Only the contract's family and helper, with the `extraSession`
 * permission. The rules and the charge are `@repo/billing`'s
 * (`proposeExtraSession` and friends); every refusal is typed (one error
 * code each), every infrastructure failure becomes `ExtraSessionRepoError`.
 */
import {
  allowedExtraSessionDates,
  answerExtraSession,
  cancelExtraSession,
  checkExtraSessionSlot,
  extraSessionActions,
  extraSessionPolicy,
  loadExtraSessionContext,
  priceExtraSession,
  proposeExtraSession,
  quoteExtraSession,
  withdrawExtraSession,
  ExtraSessionNotFoundError,
  ExtraSessionRefusedError,
  type ExtraSessionPolicy,
  type PartySide
} from '@repo/billing';
import { zoneLabel } from '@repo/calendar';
import {
  ContractBillingRepo,
  ContractRepo,
  type Contract,
  type ExtraSession,
  type SessionCharge
} from '@repo/db';
import { Data, Effect, Schema } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { authenticate, requirePermissions, type UserAndSession } from '@/api/lib/effect-auth';
import { parseJsonBody, validateInput } from '@/api/lib/schema-validator';
import { validateContractId } from './contracts.validator';

// ---------------------------------------------------------------------------
// Errors

/** Anything below the rules failed (database, provider). */
export class ExtraSessionRepoError extends Data.TaggedError('ExtraSessionRepoError')<{
  cause: unknown;
}> {}

/** Unknown contract, or the viewer isn't one of its parties (outsiders
 * can't tell the difference). */
export class ExtraSessionContractNotFoundError extends Data.TaggedError(
  'ExtraSessionContractNotFoundError'
)<{}> {}

type DomainError = ExtraSessionRefusedError | ExtraSessionNotFoundError | ExtraSessionRepoError;

/** Keeps the typed refusals; anything else is an infrastructure failure. */
const mapFailure = <A, E extends { _tag: string }, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, DomainError, R> =>
  effect.pipe(
    Effect.catchAll(
      (error): Effect.Effect<never, DomainError> =>
        error._tag === 'ExtraSessionRefusedError'
          ? Effect.fail(error as unknown as ExtraSessionRefusedError)
          : error._tag === 'ExtraSessionNotFoundError'
            ? Effect.fail(error as unknown as ExtraSessionNotFoundError)
            : Effect.fail(new ExtraSessionRepoError({ cause: error }))
    )
  );

// ---------------------------------------------------------------------------
// Input

const minutes = Schema.Int.pipe(Schema.between(0, 24 * 60));
const optionalNote = Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(1000))));
const authorised = Schema.optional(Schema.NullOr(Schema.Int.pipe(Schema.positive())));

export const extraSessionSlotValidationError = {
  code: 'INVALID_EXTRA_SESSION',
  message: 'Choose a date, a start and end time and one of the contract’s services.'
} as const;

export const extraSessionSlotSchema = Schema.Struct({
  date: Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)),
  startMinutes: minutes,
  endMinutes: minutes,
  serviceId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200))
});
const validateSlot = validateInput(extraSessionSlotSchema, extraSessionSlotValidationError);

export const extraSessionProposalSchema = Schema.Struct({
  ...extraSessionSlotSchema.fields,
  note: optionalNote,
  /** The family's "I authorise Poppynz to charge my card $X": the amount it
   * was shown, in cents. */
  authorisedCents: authorised
});
export type ExtraSessionProposalInput = Schema.Schema.Type<typeof extraSessionProposalSchema>;
const validateProposal = validateInput(extraSessionProposalSchema, extraSessionSlotValidationError);

export const extraSessionResponseValidationError = {
  code: 'INVALID_EXTRA_SESSION_RESPONSE',
  message: 'Answer with accept or decline.'
} as const;
export const extraSessionResponseSchema = Schema.Struct({
  response: Schema.Literal('accept', 'decline'),
  note: optionalNote,
  authorisedCents: authorised
});
export type ExtraSessionResponseInput = Schema.Schema.Type<typeof extraSessionResponseSchema>;
const validateResponse = validateInput(
  extraSessionResponseSchema,
  extraSessionResponseValidationError
);

const blank = (value: string | null | undefined) =>
  value === undefined || value === null || value.trim() === '' ? null : value.trim();

// ---------------------------------------------------------------------------
// Views

const sideOf = (contract: Contract, userId: string): PartySide | null =>
  contract.familyUserId === userId
    ? 'family'
    : contract.providerUserId === userId
      ? 'helper'
      : null;

/** Where its charge is, in the viewer's words. */
export type ExtraSessionChargeState =
  | 'awaiting_answer'
  | 'closed'
  | 'charge_pending'
  | 'in_cycle'
  | 'charging'
  | 'charge_failed'
  | 'charged'
  | 'cancelled';

const chargeState = (row: ExtraSession): ExtraSessionChargeState => {
  switch (row.status) {
    case 'proposed':
      return 'awaiting_answer';
    case 'withdrawn':
    case 'declined':
    case 'lapsed':
      return 'closed';
    case 'agreed':
      return 'charge_pending';
    case 'in_cycle':
      return 'in_cycle';
    case 'charging':
      return 'charging';
    case 'charge_failed':
      return 'charge_failed';
    case 'charged':
      return 'charged';
    case 'cancelled':
      return 'cancelled';
  }
};

/** One extra session as a party sees it: the family its total (care, fee
 * and tax), the helper what they receive. */
export const extraSessionView = (
  row: ExtraSession,
  viewer: { userId: string; side: PartySide },
  now: Date,
  money: { familyTotalCents: number | null; helperShareCents: number | null }
) => {
  const actions = extraSessionActions(row, viewer.side, now);
  return {
    id: row.id,
    status: row.status,
    chargeState: chargeState(row),
    date: row.date,
    startMinutes: row.startMinutes,
    endMinutes: row.endMinutes,
    elapsedMinutes: row.elapsedMinutes,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    proposedBySide: row.proposedBySide,
    proposedByMe: row.proposedByUserId === viewer.userId,
    note: row.note,
    respondBy: row.respondBy.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    responseNote: row.responseNote,
    agreedAt: row.agreedAt?.toISOString() ?? null,
    chargeAt: row.chargeAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    chargedAt: row.chargedAt?.toISOString() ?? null,
    cycleId: row.cycleId,
    sessionId: row.sessionId,
    familyTotalCents: viewer.side === 'family' ? money.familyTotalCents : null,
    helperShareCents: viewer.side === 'helper' ? money.helperShareCents : null,
    /** Accepting needs the family's authorisation of exactly this amount. */
    authoriseCents:
      viewer.side === 'family' && actions.includes('accept') ? money.familyTotalCents : null,
    lastError: viewer.side === 'family' && row.status === 'charge_failed' ? row.lastError : null,
    actions
  };
};

export type ExtraSessionView = ReturnType<typeof extraSessionView>;

/** The settings the propose dialog states (never hard-coded in the web). */
const policyView = (policy: ExtraSessionPolicy) => ({
  lookbackDays: policy.lookbackDays,
  chargeDelayMinutes: policy.chargeDelayMinutes,
  responseHours: policy.responseHours,
  minMinutes: policy.minMinutes,
  windowDays: policy.windowDays
});

/** The contract, when the viewer is one of its parties. */
const loadParty = (viewerUserId: string, contractId: string) =>
  Effect.gen(function* () {
    const contract = yield* (yield* ContractRepo).findById(contractId);
    const side = contract ? sideOf(contract, viewerUserId) : null;
    if (!contract || side === null) {
      return yield* Effect.fail(new ExtraSessionContractNotFoundError());
    }
    return { contract, side };
  });

/** What each row costs the family / pays the helper: the frozen charge once
 * charged, the frozen quote once its own charge started, else priced now. */
const moneyOf = (
  row: ExtraSession,
  ctx: NonNullable<Effect.Effect.Success<ReturnType<typeof loadExtraSessionContext>>>,
  charges: ReadonlyArray<SessionCharge>
) =>
  Effect.gen(function* () {
    const charge = charges.find((c) => c.sessionId === row.sessionId && row.sessionId !== null);
    if (charge) {
      return {
        familyTotalCents: charge.familyTotalCents,
        helperShareCents: charge.helperShareCents
      };
    }
    const price = yield* priceExtraSession(ctx.billing, ctx.accepted, row);
    return {
      familyTotalCents:
        row.familyTotalCents ?? price?.amounts.familyTotalCents ?? row.quotedTotalCents,
      helperShareCents: price?.amounts.providerShareCents ?? null
    };
  });

/**
 * The contract's extra sessions (newest first; one cycle's with `cycleId`)
 * and the propose dialog's facts: whether the viewer may propose now and
 * why not, the dates allowed, the services at their agreed rates, and the
 * settings the copy states.
 */
export const listExtraSessionsProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  cycleId: string | null,
  canAct: boolean,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const { side } = yield* loadParty(viewer.id, contractId);
    const ctx = yield* loadExtraSessionContext(contractId);
    const policy = yield* extraSessionPolicy;
    if (!ctx) {
      return {
        extraSessions: [] as Array<ExtraSessionView>,
        propose: null,
        policy: policyView(policy)
      };
    }
    const charges = yield* (yield* ContractBillingRepo).listSessionCharges(contractId);
    const rows = ctx.extras
      .filter((row) => cycleId === null || row.cycleId === cycleId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const extraSessions: Array<ExtraSessionView> = [];
    for (const row of rows) {
      const money = yield* moneyOf(row, ctx, charges);
      const view = extraSessionView(row, { userId: viewer.id, side }, now, money);
      extraSessions.push(canAct ? view : { ...view, actions: [], authoriseCents: null });
    }
    const range = allowedExtraSessionDates(ctx, now, policy);
    // Whether anything at all could be proposed now (the contract and its
    // billing are running and some date is open): a probe slot is checked
    // for the contract-level refusals only.
    const contractRefusal = range
      ? checkExtraSessionSlot(
          {
            date: range.last,
            startMinutes: 0,
            endMinutes: 24 * 60,
            serviceId: ctx.accepted.services[0]?.serviceId ?? ''
          },
          { ...ctx, sessions: [], extras: [] },
          now,
          policy
        )
      : 'beyond_window';
    const blocking =
      contractRefusal === 'contract_not_active' || contractRefusal === 'billing_unavailable'
        ? contractRefusal
        : range === null
          ? 'beyond_window'
          : null;
    return {
      extraSessions,
      propose: {
        canPropose: canAct && blocking === null,
        refusal: blocking,
        firstDate: range?.first ?? null,
        lastDate: range?.last ?? null,
        timeZone: ctx.zone,
        timeZoneLabel: zoneLabel(ctx.zone),
        viewerSide: side,
        services: ctx.accepted.services.map((service) => ({
          serviceId: service.serviceId,
          name: service.name,
          rateCents: service.rateCents
        }))
      },
      policy: policyView(policy)
    };
  });

/** The propose dialog's live price: the slot checked like a proposal. */
export const quoteExtraSessionProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  slot: Schema.Schema.Type<typeof extraSessionSlotSchema>,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const { side } = yield* loadParty(userAndSession.user.id, contractId);
    const price = yield* quoteExtraSession(contractId, slot, now).pipe(mapFailure);
    const amounts = price.amounts;
    return {
      quote: {
        elapsedMinutes: price.elapsedMinutes,
        rateCents: price.rateCents,
        careCents: amounts.serviceCents,
        careTaxLines: amounts.serviceTaxLines.map((line) => ({
          label: line.label,
          taxCents: line.taxCents
        })),
        feeBps: amounts.familyFeeBps,
        feeCents: amounts.familyFeeCents,
        feeTaxLines: amounts.familyFeeTaxLines.map((line) => ({
          label: line.label,
          taxCents: line.taxCents
        })),
        familyTotalCents: side === 'family' ? amounts.familyTotalCents : null,
        helperShareCents: side === 'helper' ? amounts.providerShareCents : null,
        /** What the family authorises (both sides see it is authorised). */
        authoriseCents: amounts.familyTotalCents
      }
    };
  });

export const proposeExtraSessionProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  input: ExtraSessionProposalInput,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const { side } = yield* loadParty(viewer.id, contractId);
    const row = yield* proposeExtraSession(
      contractId,
      { userId: viewer.id, side },
      {
        date: input.date,
        startMinutes: input.startMinutes,
        endMinutes: input.endMinutes,
        serviceId: input.serviceId,
        note: blank(input.note),
        authorisedCents: side === 'family' ? (input.authorisedCents ?? null) : null
      },
      now
    ).pipe(mapFailure);
    return {
      extraSession: extraSessionView(row, { userId: viewer.id, side }, now, {
        familyTotalCents: row.quotedTotalCents,
        helperShareCents: null
      })
    };
  });

export const respondToExtraSessionProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  extraId: string,
  input: ExtraSessionResponseInput,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const { side } = yield* loadParty(viewer.id, contractId);
    const row = yield* answerExtraSession(
      contractId,
      extraId,
      { userId: viewer.id, side },
      {
        response: input.response,
        note: blank(input.note),
        authorisedCents: side === 'family' ? (input.authorisedCents ?? null) : null
      },
      now
    ).pipe(mapFailure);
    return {
      extraSession: extraSessionView(row, { userId: viewer.id, side }, now, {
        familyTotalCents: row.familyTotalCents ?? row.quotedTotalCents,
        helperShareCents: null
      })
    };
  });

export const withdrawExtraSessionProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  extraId: string,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const { side } = yield* loadParty(viewer.id, contractId);
    const row = yield* withdrawExtraSession(
      contractId,
      extraId,
      { userId: viewer.id, side },
      now
    ).pipe(mapFailure);
    return {
      extraSession: extraSessionView(row, { userId: viewer.id, side }, now, {
        familyTotalCents: row.quotedTotalCents,
        helperShareCents: null
      })
    };
  });

export const cancelExtraSessionProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  extraId: string,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const { side } = yield* loadParty(viewer.id, contractId);
    const row = yield* cancelExtraSession(
      contractId,
      extraId,
      { userId: viewer.id, side },
      now
    ).pipe(mapFailure);
    return {
      extraSession: extraSessionView(row, { userId: viewer.id, side }, now, {
        familyTotalCents: row.quotedTotalCents,
        helperShareCents: null
      })
    };
  });

// ---------------------------------------------------------------------------
// Route programs: parsing, validation, authentication, authorisation, domain.

type ProgramError = DomainError | ExtraSessionContractNotFoundError;

const mapRepo = <A, E extends { _tag: string }, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, ProgramError, R> =>
  effect.pipe(
    Effect.catchAll(
      (error): Effect.Effect<never, ProgramError> =>
        error._tag === 'ExtraSessionContractNotFoundError' ||
        error._tag === 'ExtraSessionRefusedError' ||
        error._tag === 'ExtraSessionNotFoundError' ||
        error._tag === 'ExtraSessionRepoError'
          ? Effect.fail(error as unknown as ProgramError)
          : Effect.fail(new ExtraSessionRepoError({ cause: error }))
    )
  );

const write = (headers: Headers) =>
  authenticate(headers).pipe(
    Effect.flatMap((authenticated) =>
      requirePermissions(headers, { extraSession: ['write'] })(authenticated)
    )
  );

const extraIdOf = (c: HonoContext<HonoEnv>) => validateContractId(c.req.param('extraId'));

export const listExtraSessionsRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const rawCycle = c.req.query('cycleId');
    const cycleId = rawCycle ? yield* validateContractId(rawCycle) : null;
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { extraSession: ['read'] })(
      authenticated
    );
    // Actions are offered only with the write permission.
    const canAct = yield* requirePermissions(headers, { extraSession: ['write'] })(
      authenticated
    ).pipe(
      Effect.as(true),
      Effect.catchTag('ForbiddenError', () => Effect.succeed(false))
    );
    return yield* listExtraSessionsProgram(userAndSession, contractId, cycleId, canAct, now).pipe(
      mapRepo
    );
  });

export const quoteExtraSessionRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const body = yield* parseJsonBody(c, extraSessionSlotValidationError);
    const slot = yield* validateSlot(body);
    const userAndSession = yield* write(headers);
    return yield* quoteExtraSessionProgram(userAndSession, contractId, slot, now).pipe(mapRepo);
  });

export const proposeExtraSessionRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const body = yield* parseJsonBody(c, extraSessionSlotValidationError);
    const input = yield* validateProposal(body);
    const userAndSession = yield* write(headers);
    return yield* proposeExtraSessionProgram(userAndSession, contractId, input, now).pipe(mapRepo);
  });

export const respondToExtraSessionRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const extraId = yield* extraIdOf(c);
    const body = yield* parseJsonBody(c, extraSessionResponseValidationError);
    const input = yield* validateResponse(body);
    const userAndSession = yield* write(headers);
    return yield* respondToExtraSessionProgram(
      userAndSession,
      contractId,
      extraId,
      input,
      now
    ).pipe(mapRepo);
  });

export const withdrawExtraSessionRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const extraId = yield* extraIdOf(c);
    const userAndSession = yield* write(headers);
    return yield* withdrawExtraSessionProgram(userAndSession, contractId, extraId, now).pipe(
      mapRepo
    );
  });

export const cancelExtraSessionRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const extraId = yield* extraIdOf(c);
    const userAndSession = yield* write(headers);
    return yield* cancelExtraSessionProgram(userAndSession, contractId, extraId, now).pipe(mapRepo);
  });
