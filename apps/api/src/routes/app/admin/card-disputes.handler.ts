/**
 * Card disputes (chargebacks), Tier 3 step 4 — spec 2026-10-28 §15:
 *
 *   GET  /admin/card-disputes                         the list (status, due
 *                                                     date); amounts Poppynz
 *                                                     bears with `finance`
 *   GET  /admin/card-disputes/flags                   families with an open
 *                                                     dispute or held by an
 *                                                     admin (banners)
 *   GET  /admin/card-disputes/:id                     one, with its sessions
 *                                                     and evidence pack
 *   PUT  /admin/card-disputes/:id/summary             save the summary draft
 *   POST /admin/card-disputes/:id/evidence            submit it to Stripe
 *   POST /admin/card-disputes/:id/allocations         a lost dispute, per
 *                                                     session
 *   POST /admin/card-disputes/families/:userId/suspend  hold the family's
 *                                                     contracts (reason)
 *   POST /admin/card-disputes/families/:userId/resume   lift it
 *
 * Gated by the `cardDispute` permission only (admins: all of it; the
 * accountant: `read` and `finance`). Every action is audited.
 */
import {
  allocateLostCardDispute,
  assembleEvidencePack,
  buildEvidence,
  CardDisputeError,
  defaultEvidenceSummary,
  defaultHelperForfeit,
  familyReviewState,
  resumeFamilyContracts,
  saveEvidenceSummary,
  submitCardDisputeEvidence,
  suspendFamilyContracts,
  type EvidencePack
} from '@repo/billing';
import { CardDisputeRepo, UserProfileRepo, UserRepo, type CardDispute } from '@repo/db';
import { Cause, Data, Effect, Exit, Option, Schema } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  AuthService,
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';
import {
  parseJsonBody,
  requestValidationErrorToResponse,
  validateInput
} from '@/api/lib/schema-validator';

/** Anything below the dispute rules failed (database, provider, mail). */
export class CardDisputeRepoError extends Data.TaggedError('CardDisputeRepoError')<{
  cause: unknown;
}> {}

/** Keeps the typed refusals; anything else is an infrastructure failure. */
const mapFailure = <A, E extends { _tag: string }, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, CardDisputeError | CardDisputeRepoError, R> =>
  effect.pipe(
    Effect.catchAll(
      (error): Effect.Effect<never, CardDisputeError | CardDisputeRepoError> =>
        error instanceof CardDisputeError
          ? Effect.fail(error)
          : Effect.fail(new CardDisputeRepoError({ cause: error }))
    )
  );

const idOf = validateInput(Schema.UUID, {
  code: 'INVALID_CARD_DISPUTE_ID',
  message: 'A valid id is required.'
} as const);
const userIdOf = validateInput(Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(200)), {
  code: 'INVALID_CARD_DISPUTE_USER',
  message: 'A valid user id is required.'
} as const);

export const listQueryValidationError = {
  code: 'INVALID_CARD_DISPUTE_FILTER',
  message: 'Filter by status (open, closed, all) and due (overdue, week).'
} as const;
export const listQuerySchema = Schema.Struct({
  status: Schema.optional(Schema.Literal('open', 'closed', 'all')),
  due: Schema.optional(Schema.Literal('overdue', 'week'))
});
const validateListQuery = validateInput(listQuerySchema, listQueryValidationError);

export const summaryValidationError = {
  code: 'INVALID_CARD_DISPUTE_SUMMARY',
  message: 'Write the summary for the bank (at most 20,000 characters).'
} as const;
export const summarySchema = Schema.Struct({
  summary: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(20_000))
});
const validateSummary = validateInput(summarySchema, summaryValidationError);

export const allocationsValidationError = {
  code: 'INVALID_CARD_DISPUTE_ALLOCATION',
  message:
    'For each session: Poppynz absorbs it, or the helper did not provide the service (with a reason).'
} as const;
export const allocationsSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      sessionId: Schema.UUID,
      allocation: Schema.Literal('poppynz_absorbs', 'helper_not_provided'),
      reason: Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(2000)))),
      helperForfeitCents: Schema.optional(Schema.NullOr(Schema.Int.pipe(Schema.nonNegative())))
    })
  ).pipe(Schema.minItems(1))
});
const validateAllocations = validateInput(allocationsSchema, allocationsValidationError);

export const suspendValidationError = {
  code: 'INVALID_FAMILY_SUSPENSION',
  message: 'Choose why (unreliable payment method or suspected fraud) and say what was found.'
} as const;
export const suspendSchema = Schema.Struct({
  reason: Schema.Literal('unreliable_payment_method', 'suspected_fraud'),
  note: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  disputeId: Schema.optional(Schema.NullOr(Schema.UUID))
});
const validateSuspend = validateInput(suspendSchema, suspendValidationError);

export const resumeValidationError = {
  code: 'INVALID_FAMILY_RESUME',
  message: 'Say why the contracts can resume.'
} as const;
export const resumeSchema = Schema.Struct({
  note: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(2000))
});
const validateResume = validateInput(resumeSchema, resumeValidationError);

const iso = (date: Date | null) => date?.toISOString() ?? null;

/** "Priya Tester" — admins see full names. */
const fullName = (userId: string) =>
  Effect.gen(function* () {
    const profile = yield* (yield* UserProfileRepo)
      .findByUserId(userId)
      .pipe(Effect.orElseSucceed(() => null));
    const named = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
    if (named) return named;
    const user = yield* (yield* UserRepo).findById(userId).pipe(Effect.orElseSucceed(() => null));
    return user?.name ?? 'Poppynz member';
  });

const DAY_MS = 86_400_000;

const disputeSummary = (dispute: CardDispute, familyName: string, finance: boolean) => ({
  id: dispute.id,
  providerReference: dispute.providerReference,
  paymentId: dispute.paymentId,
  familyUserId: dispute.familyUserId,
  familyName,
  contractId: dispute.contractId,
  scope: dispute.scope,
  amountCents: dispute.amountCents,
  currency: dispute.currency,
  reason: dispute.reason,
  status: dispute.status,
  triage: dispute.triage,
  evidenceDueBy: iso(dispute.evidenceDueBy),
  openedAt: dispute.providerCreatedAt.toISOString(),
  closedAt: iso(dispute.closedAt),
  // What Poppynz bears: the debit, minus what came back, plus the fees.
  money: finance
    ? {
        withdrawnCents: dispute.withdrawnCents,
        reinstatedCents: dispute.reinstatedCents,
        feeCents: dispute.feeCents,
        netCents: dispute.withdrawnCents - dispute.reinstatedCents + dispute.feeCents
      }
    : null
});

// ---------------------------------------------------------------------------
// Programs

export const listCardDisputesProgram = (
  filter: Schema.Schema.Type<typeof listQuerySchema>,
  access: { finance: boolean },
  now: Date
) =>
  Effect.gen(function* () {
    const repo = yield* CardDisputeRepo;
    const status = filter.status ?? 'open';
    const rows = yield* repo.list(status === 'all' ? {} : { open: status === 'open' });
    const due = rows.filter((row) => {
      if (!filter.due) return true;
      if (row.closedAt !== null || row.evidenceDueBy === null) return false;
      return filter.due === 'overdue'
        ? row.evidenceDueBy <= now
        : row.evidenceDueBy > now && row.evidenceDueBy.getTime() - now.getTime() <= 7 * DAY_MS;
    });
    const names = new Map<string, string>();
    for (const row of due) {
      if (!names.has(row.familyUserId))
        names.set(row.familyUserId, yield* fullName(row.familyUserId));
    }
    const disputes = due.map((row) =>
      disputeSummary(row, names.get(row.familyUserId)!, access.finance)
    );
    return {
      disputes,
      totals: access.finance
        ? {
            netCents: disputes.reduce((t, row) => t + (row.money?.netCents ?? 0), 0),
            feeCents: disputes.reduce((t, row) => t + (row.money?.feeCents ?? 0), 0)
          }
        : null
    };
  }).pipe((errors) => mapFailure(errors));

/** Families to flag in the admin console: an open dispute, or contracts an
 * admin is holding. */
export const cardDisputeFlagsProgram = () =>
  Effect.gen(function* () {
    const open = yield* (yield* CardDisputeRepo).list({ open: true });
    const families = new Map<string, number>();
    for (const row of open)
      families.set(row.familyUserId, (families.get(row.familyUserId) ?? 0) + 1);
    const flags = [];
    for (const [userId, openDisputes] of families) {
      const state = yield* familyReviewState(userId);
      flags.push({ userId, openDisputes, suspended: state.suspended });
    }
    return { families: flags };
  }).pipe((errors) => mapFailure(errors));

const packView = (pack: EvidencePack) => ({
  family: pack.family,
  helper: pack.helper,
  contract: pack.contract,
  payment: pack.payment
    ? {
        ...pack.payment,
        createdAt: pack.payment.createdAt.toISOString(),
        authorisedAt: iso(pack.payment.authorisedAt),
        capturedAt: iso(pack.payment.capturedAt),
        refundedAt: iso(pack.payment.refundedAt)
      }
    : null,
  cycle: pack.cycle
    ? {
        ...pack.cycle,
        holdAt: pack.cycle.holdAt.toISOString(),
        captureAt: pack.cycle.captureAt.toISOString(),
        fundedAt: iso(pack.cycle.fundedAt),
        capturedAt: iso(pack.cycle.capturedAt)
      }
    : null,
  agreement: pack.agreement.map((row) => ({ ...row, signedAt: row.signedAt.toISOString() })),
  sessions: pack.sessions.map((row) => ({
    sessionId: row.sessionId,
    date: row.date,
    serviceName: row.serviceName,
    startMinutes: row.startMinutes,
    endMinutes: row.endMinutes,
    status: row.status,
    familyTotalCents: row.familyTotalCents,
    helperShareCents: row.helperShareCents,
    disputedCents: row.disputedCents,
    defaultHelperForfeitCents: defaultHelperForfeit(row),
    allocation: row.allocation,
    allocationReason: row.allocationReason,
    helperForfeitCents: row.helperForfeitCents,
    recovered: row.recoveryId !== null,
    allocatedAt: iso(row.allocatedAt),
    resolution: row.resolution
      ? {
          ...row.resolution,
          recordedAt: row.resolution.recordedAt.toISOString(),
          respondedAt: iso(row.resolution.respondedAt),
          decidedAt: iso(row.resolution.decidedAt),
          events: row.resolution.events.map((event) => ({ ...event, at: event.at.toISOString() }))
        }
      : null,
    extraAuthorisation: row.extraAuthorisation
      ? {
          authorisedAt: iso(row.extraAuthorisation.authorisedAt),
          authorisedCents: row.extraAuthorisation.authorisedCents
        }
      : null
  })),
  messages: pack.messages.map((row) => ({ ...row, sentAt: row.sentAt.toISOString() })),
  refunds: pack.refunds.map((row) => ({
    ...row,
    refundedAt: iso(row.refundedAt),
    createdAt: row.createdAt.toISOString()
  })),
  submissions: pack.submissions.map((row) => ({
    id: row.id,
    submittedByUserId: row.submittedByUserId,
    submittedAt: row.submittedAt.toISOString(),
    summary: row.summary,
    fields: row.fields,
    files: row.files,
    providerStatus: row.providerStatus
  }))
});

export const getCardDisputeProgram = (id: string, access: { finance: boolean }) =>
  Effect.gen(function* () {
    const dispute = yield* (yield* CardDisputeRepo).findById(id);
    if (dispute === null) return yield* Effect.fail(new CardDisputeError({ reason: 'not_found' }));
    const pack = yield* assembleEvidencePack(id);
    const suggested = defaultEvidenceSummary(pack);
    const summary = dispute.evidenceSummary ?? suggested;
    const preview = buildEvidence(pack, summary);
    const review = yield* familyReviewState(dispute.familyUserId);
    const names = new Map<string, string>();
    for (const userId of [
      ...review.history.map((row) => row.actorUserId),
      ...pack.submissions.map((row) => row.submittedByUserId)
    ]) {
      if (userId && !names.has(userId)) names.set(userId, yield* fullName(userId));
    }
    return {
      dispute: {
        ...disputeSummary(dispute, pack.family.name, access.finance),
        chargeRefundable: dispute.chargeRefundable,
        evidenceSubmissionCount: dispute.evidenceSubmissionCount,
        evidenceSummary: dispute.evidenceSummary,
        evidenceSummaryAt: iso(dispute.evidenceSummaryAt),
        suggestedSummary: suggested,
        evidenceFields: preview.text,
        evidenceDocuments: {
          serviceDocumentation: preview.documentation.map((section) => section.heading),
          customerCommunication: preview.communication.length > 0
        },
        pack: packView(pack),
        names: Object.fromEntries(names),
        family: {
          suspended: review.suspended,
          contractIds: review.contractIds,
          suspendable: review.suspendable,
          history: review.history.map((row) => ({
            ...row,
            actorName: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null,
            at: row.at.toISOString()
          }))
        }
      }
    };
  }).pipe((errors) => mapFailure(errors));

// ---------------------------------------------------------------------------
// Route programs

const gate = (headers: Headers, permissions: Parameters<typeof requirePermissions>[1]) =>
  Effect.flatMap(authenticate(headers), requirePermissions(headers, permissions));

const financeAccess = (headers: Headers) =>
  Effect.gen(function* () {
    const auth = yield* AuthService;
    return { finance: yield* auth.userHasPermission(headers, { cardDispute: ['finance'] }) };
  });

export const listCardDisputesRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const filter = yield* validateListQuery({
      ...(c.req.query('status') ? { status: c.req.query('status') } : {}),
      ...(c.req.query('due') ? { due: c.req.query('due') } : {})
    });
    yield* gate(headers, { cardDispute: ['read'] });
    const access = yield* financeAccess(headers);
    return yield* listCardDisputesProgram(filter, access, now);
  });

export const cardDisputeFlagsRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    yield* gate(headers, { cardDispute: ['read'] });
    return yield* cardDisputeFlagsProgram();
  });

export const getCardDisputeRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const id = yield* idOf(c.req.param('id'));
    yield* gate(headers, { cardDispute: ['read', 'review'] });
    const access = yield* financeAccess(headers);
    return yield* getCardDisputeProgram(id, access);
  });

export const saveSummaryRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const id = yield* idOf(c.req.param('id'));
    const input = yield* validateSummary(yield* parseJsonBody(c, summaryValidationError));
    const admin = yield* gate(headers, { cardDispute: ['review', 'respond'] });
    const saved = yield* saveEvidenceSummary(id, input.summary, admin.user.id, now).pipe((errors) =>
      mapFailure(errors)
    );
    return { dispute: { id: saved.id, evidenceSummaryAt: iso(saved.evidenceSummaryAt) } };
  });

export const submitEvidenceRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const id = yield* idOf(c.req.param('id'));
    const input = yield* validateSummary(yield* parseJsonBody(c, summaryValidationError));
    const admin = yield* gate(headers, { cardDispute: ['review', 'respond'] });
    const submission = yield* submitCardDisputeEvidence(id, input.summary, admin.user.id, now).pipe(
      (errors) => mapFailure(errors)
    );
    return {
      submission: {
        id: submission.id,
        submittedAt: submission.submittedAt.toISOString(),
        providerStatus: submission.providerStatus
      }
    };
  });

export const allocateRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const id = yield* idOf(c.req.param('id'));
    const input = yield* validateAllocations(yield* parseJsonBody(c, allocationsValidationError));
    const admin = yield* gate(headers, { cardDispute: ['review', 'decide'] });
    const rows = yield* allocateLostCardDispute(
      id,
      input.items.map((item) => ({
        sessionId: item.sessionId,
        allocation: item.allocation,
        reason: item.reason ?? null,
        helperForfeitCents: item.helperForfeitCents ?? null
      })),
      admin.user.id,
      now
    ).pipe((errors) => mapFailure(errors));
    return {
      allocations: rows.map((row) => ({
        sessionId: row.sessionId,
        allocation: row.allocation,
        helperForfeitCents: row.helperForfeitCents,
        recovered: row.recoveryId !== null
      }))
    };
  });

export const suspendFamilyRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const familyUserId = yield* userIdOf(c.req.param('userId'));
    const input = yield* validateSuspend(yield* parseJsonBody(c, suspendValidationError));
    const admin = yield* gate(headers, { cardDispute: ['review', 'decide'] });
    const contractIds = yield* suspendFamilyContracts(
      { familyUserId, reason: input.reason, note: input.note, disputeId: input.disputeId ?? null },
      admin.user.id,
      now
    ).pipe((errors) => mapFailure(errors));
    return { contractIds };
  });

export const resumeFamilyRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const familyUserId = yield* userIdOf(c.req.param('userId'));
    const input = yield* validateResume(yield* parseJsonBody(c, resumeValidationError));
    const admin = yield* gate(headers, { cardDispute: ['review', 'decide'] });
    const contractIds = yield* resumeFamilyContracts(
      { familyUserId, note: input.note },
      admin.user.id,
      now
    ).pipe((errors) => mapFailure(errors));
    return { contractIds };
  });

type CardDisputeRouteError =
  | Effect.Effect.Error<ReturnType<typeof listCardDisputesRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof cardDisputeFlagsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getCardDisputeRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof saveSummaryRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof submitEvidenceRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof allocateRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof suspendFamilyRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof resumeFamilyRouteProgram>>;

const refusalToResponse = (c: HonoContext<HonoEnv>, error: CardDisputeError) => {
  const reason = error.reason;
  const refused = <C extends string>(code: C, message: string, status: 404 | 409 | 422 | 502) =>
    c.json({ error: { code, message, ...(error.detail ? { detail: error.detail } : {}) } }, status);
  switch (reason) {
    case 'not_found':
      return refused('CARD_DISPUTE_NOT_FOUND', 'Not found.', 404);
    case 'not_open':
      return refused(
        'CARD_DISPUTE_NOT_OPEN',
        'This dispute is closed or its evidence was sent.',
        409
      );
    case 'already_submitted':
      return refused('CARD_DISPUTE_EVIDENCE_SUBMITTED', 'Evidence was already submitted.', 409);
    case 'summary_required':
      return refused('CARD_DISPUTE_SUMMARY_REQUIRED', 'Write the summary for the bank.', 422);
    case 'not_lost':
      return refused('CARD_DISPUTE_NOT_LOST', 'Only a lost dispute is allocated.', 409);
    case 'unknown_session':
      return refused('CARD_DISPUTE_UNKNOWN_SESSION', 'That session is not on this dispute.', 422);
    case 'already_allocated':
      return refused('CARD_DISPUTE_ALREADY_ALLOCATED', 'That session was already decided.', 409);
    case 'reason_required':
      return refused('CARD_DISPUTE_REASON_REQUIRED', 'Say why the helper bears it.', 422);
    case 'forfeit_too_high':
      return refused(
        'CARD_DISPUTE_FORFEIT_TOO_HIGH',
        'The helper can bear at most their share of the session.',
        422
      );
    case 'refused':
      return refused('CARD_DISPUTE_EVIDENCE_REFUSED', 'Stripe refused the evidence.', 422);
    case 'provider_unavailable':
      return refused('CARD_DISPUTE_PROVIDER_UNAVAILABLE', 'Stripe could not be reached.', 502);
    case 'nothing_to_suspend':
      return refused('FAMILY_NOTHING_TO_SUSPEND', 'The family has no contract to suspend.', 409);
    case 'nothing_to_resume':
      return refused('FAMILY_NOTHING_TO_RESUME', 'No contract of the family is on hold.', 409);
    default:
      return handleNever(c, reason);
  }
};

const errorToResponse = (c: HonoContext<HonoEnv>, error: CardDisputeRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'CardDisputeError':
      return refusalToResponse(c, error);
    case 'CardDisputeRepoError':
      return c.json(
        {
          error: {
            code: 'CARD_DISPUTES_FAILED' as const,
            message: 'Unable to process the request.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, CardDisputeRouteError>) =>
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

export async function listCardDisputesHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(listCardDisputesRouteProgram(c, c.req.raw.headers))
  );
}
export async function cardDisputeFlagsHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(cardDisputeFlagsRouteProgram(c.req.raw.headers))
  );
}
export async function getCardDisputeHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(getCardDisputeRouteProgram(c, c.req.raw.headers))
  );
}
export async function saveSummaryHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(saveSummaryRouteProgram(c, c.req.raw.headers))
  );
}
export async function submitEvidenceHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(submitEvidenceRouteProgram(c, c.req.raw.headers))
  );
}
export async function allocateHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(allocateRouteProgram(c, c.req.raw.headers))
  );
}
export async function suspendFamilyHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(suspendFamilyRouteProgram(c, c.req.raw.headers))
  );
}
export async function resumeFamilyHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(resumeFamilyRouteProgram(c, c.req.raw.headers))
  );
}
