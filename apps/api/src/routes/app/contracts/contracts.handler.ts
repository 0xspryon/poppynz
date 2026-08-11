import type { SqlError } from '@effect/sql/SqlError';
import {
  ContractRepo,
  ConversationRepo,
  ServiceOfferedRepo,
  UserProfileRepo,
  UserRepo,
  type Contract,
  type ContractServiceItem,
  type ContractSession,
  type ContractVersion,
  type ContractWithContext
} from '@repo/db';
import { contractConfig } from '@repo/env';
import { publishNotificationBestEffort } from '@repo/notify';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '../../../app-env';
import {
  authenticate,
  type UserAndSession,
  requirePermissions,
  authErrorToResponse,
  handleNever
} from '@/api/lib/effect-auth';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import {
  contractCreateJsonError,
  contractDeclineJsonError,
  contractEndJsonError,
  contractTermsJsonError,
  validateContractCreateInput,
  validateContractDeclineInput,
  validateContractEndInput,
  validateContractId,
  validateContractTermsInput,
  type ContractTermsInput
} from './contracts.validator';

export class ContractRepoError extends Data.TaggedError('ContractRepoError')<{ cause: SqlError }> {}

/** Covers unknown ids AND non-participants — outsiders can't distinguish a
 * contract that exists from one that doesn't (same posture as conversations).
 * Also covers a provider probing a family-private draft. */
export class ContractNotFoundError extends Data.TaggedError('ContractNotFoundError')<{}> {}

/** Contract creation is family-only, checked structurally against the
 * conversation's familyUserId — never against the caller's role. */
export class NotContractFamilyError extends Data.TaggedError('NotContractFamilyError')<{}> {}

/** Contracts start from an unlocked conversation only. */
export class ContractConversationNotActiveError extends Data.TaggedError(
  'ContractConversationNotActiveError'
)<{}> {}

export class ContractExistsError extends Data.TaggedError('ContractExistsError')<{
  contractId: string;
}> {}

export class UnknownContractServiceError extends Data.TaggedError(
  'UnknownContractServiceError'
)<{}> {}

/** Rates floor at half the provider's listed rate; violations name the
 * offending line items so the editor can point at the right rows. */
export class RateBelowListedError extends Data.TaggedError('RateBelowListedError')<{
  violations: Array<{ serviceId: string; listedRateCents: number }>;
}> {}

/** Half the listed rate, rounded up to whole cents — mirrored by the terms
 * editor's inline check. */
const minAllowedRateCents = (listedRateCents: number) => Math.ceil(listedRateCents / 2);

export class EmptyContractTermsError extends Data.TaggedError('EmptyContractTermsError')<{}> {}

/** The action doesn't apply to the contract's current state (double decide,
 * send without a draft, …). */
export class ContractStateError extends Data.TaggedError('ContractStateError')<{}> {}

/** The caller is a participant but the wrong side for this action. */
export class NotContractActorError extends Data.TaggedError('NotContractActorError')<{}> {}

export class ContractProposalExpiredError extends Data.TaggedError(
  'ContractProposalExpiredError'
)<{}> {}

/** Postgres unique-constraint violation (SQLSTATE 23505), possibly nested a
 * few `cause` levels deep depending on the driver wrapping. */
const isUniqueViolation = (error: SqlError): boolean => {
  let current: unknown = error.cause;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth++) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

function mapContractRepoError<A, R>(
  effect: Effect.Effect<A, SqlError, R>
): Effect.Effect<A, ContractRepoError, R> {
  return effect.pipe(
    Effect.catchTag('SqlError', (cause) => Effect.fail(new ContractRepoError({ cause })))
  );
}

/** For version inserts: a lost pending-unique-index race (two concurrent
 * revisions/amendments) is the same 409 the state check produces
 * sequentially, not a 500. */
function mapVersionInsertError<A, R>(
  effect: Effect.Effect<A, SqlError, R>
): Effect.Effect<A, ContractRepoError | ContractStateError, R> {
  return effect.pipe(
    Effect.catchTag(
      'SqlError',
      (cause): Effect.Effect<never, ContractRepoError | ContractStateError> =>
        isUniqueViolation(cause)
          ? Effect.fail(new ContractStateError())
          : Effect.fail(new ContractRepoError({ cause }))
    )
  );
}

/** The notice period is part of the agreed terms ("either side can end with 2
 * weeks' notice"), not an operational knob — hence a constant, unlike the
 * proposal expiry. */
const END_NOTICE_DAYS = 14;

/** Proposal expiry window. Config read collapses to the default rather than
 * surfacing ConfigError into every route program. */
export const contractProposalContext = contractConfig.pipe(
  Effect.orElseSucceed(() => ({ proposalExpiryDays: 14 })),
  Effect.map(({ proposalExpiryDays }) => ({
    expiryDays: proposalExpiryDays,
    cutoff: new Date(Date.now() - proposalExpiryDays * 24 * 60 * 60 * 1000)
  }))
);

const isExpired = (version: ContractVersion | null, cutoff: Date) =>
  version !== null &&
  version.status === 'proposed' &&
  version.sentAt !== null &&
  version.sentAt < cutoff;

const displayName = (
  profile: { firstName: string | null; lastName: string | null } | null,
  fallback: string
) => [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || fallback;

const loadProfileOrNull = (userId: string) =>
  UserProfileRepo.pipe(
    Effect.flatMap((repo) => repo.findByUserId(userId)),
    Effect.catchTags({
      DBNotFoundError: () => Effect.succeed(null),
      SqlError: (cause) => Effect.fail(new ContractRepoError({ cause }))
    })
  );

type ContractSide = 'family' | 'provider';

const sideOf = (contract: Contract, userId: string): ContractSide =>
  contract.familyUserId === userId ? 'family' : 'provider';

const isParticipant = (contract: Contract, userId: string) =>
  contract.familyUserId === userId || contract.providerUserId === userId;

const pendingOf = (versions: Array<ContractVersion>) =>
  versions.find((version) => version.status === 'draft' || version.status === 'proposed') ?? null;

/** Draft versions are private to their proposer — every viewer-facing shape
 * (detail, list, thread summary) must be built from this set, or a family's
 * unsent revision leaks to the provider through service names and totals. */
const visibleVersionsFor = (versions: Array<ContractVersion>, viewerUserId: string) =>
  versions.filter(
    (version) => version.status !== 'draft' || version.proposedByUserId === viewerUserId
  );

const acceptedOf = (versions: Array<ContractVersion>) =>
  versions.find((version) => version.status === 'accepted') ?? null;

const latestDecidedOf = (versions: Array<ContractVersion>) =>
  [...versions]
    .reverse()
    .find(
      (version) =>
        (version.status === 'accepted' ||
          version.status === 'declined' ||
          version.status === 'changes_requested') &&
        version.decidedAt !== null
    ) ?? null;

// Hours are never stored — they derive from the proposed sessions, per
// service, so the schedule and the money math can't disagree.
const sessionMinutes = (session: ContractSession) => session.endMinutes - session.startMinutes;

export const serviceWeeklyMinutes = (item: ContractServiceItem) =>
  item.sessions.reduce((total, session) => total + sessionMinutes(session), 0);

/** Per-service weekly cost, rounded to whole cents per service (the figure
 * each line item displays), then summed for the estimate. */
export const serviceWeeklyCents = (item: ContractServiceItem) =>
  Math.round((item.rateCents * serviceWeeklyMinutes(item)) / 60);

export const weeklyEstimateCents = (services: Array<ContractServiceItem>) =>
  services.reduce((total, item) => total + serviceWeeklyCents(item), 0);

/** All contract dates (session times, starts/ends, "today") are NZ wall-clock
 * — Pacific/Auckland — regardless of where the server runs. en-CA formats as
 * YYYY-MM-DD. */
const nzIsoDate = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(at);

const todayIsoDate = () => nzIsoDate(new Date());

const DAY_MS = 24 * 60 * 60 * 1000;

/** Last working day of the notice flow — derived, never stored. */
const noticeEndsOn = (contract: Contract) =>
  contract.endNoticedAt !== null
    ? nzIsoDate(new Date(contract.endNoticedAt.getTime() + END_NOTICE_DAYS * DAY_MS))
    : null;

/** The date the contract actually stops working: the earlier of the notice
 * flow's last working day and the negotiated end-date term (if either). */
export const effectiveEndsOn = (contract: Contract, accepted: ContractVersion | null) => {
  const candidates = [noticeEndsOn(contract), accepted?.endsOn ?? null].filter(
    (value): value is string => value !== null
  );
  if (candidates.length === 0) return null;
  return candidates.sort()[0];
};

export type PresentedContractStatus =
  | 'draft'
  | 'proposed'
  | 'changes_requested'
  | 'declined'
  | 'expired'
  | 'active'
  | 'ending'
  | 'ended';

/** Read-time states: a running contract past its effective end date (notice
 * period or the negotiated end-date term) presents as ended, and an undecided
 * pre-active proposal past the expiry window presents as expired — neither is
 * ever written back. */
export const presentedContractStatus = (
  contract: Contract,
  pending: ContractVersion | null,
  accepted: ContractVersion | null,
  cutoff: Date
): PresentedContractStatus => {
  // Strictly past: the effective end date is the LAST WORKING day — the
  // contract is still running (payments running) for the whole of it.
  const endsOn = effectiveEndsOn(contract, accepted);
  if (
    (contract.status === 'ending' || contract.status === 'active') &&
    endsOn !== null &&
    endsOn < todayIsoDate()
  ) {
    return 'ended';
  }
  if (contract.status === 'proposed' && isExpired(pending, cutoff)) {
    return 'expired';
  }
  return contract.status;
};

/** A family-private draft (never sent, or withdrawn before any decision) is
 * invisible to the provider. The contract-status invariant makes this a
 * one-liner: status is "draft" exactly when no version was ever decided. */
const hiddenFromViewer = (contract: Contract, viewerUserId: string) =>
  contract.status === 'draft' && contract.providerUserId === viewerUserId;

const newsAtFor = (row: ContractWithContext, viewerUserId: string): Date | null => {
  const pending = pendingOf(row.versions);
  const lastDecided = latestDecidedOf(row.versions);
  const candidates: Array<Date> = [];
  if (
    pending?.status === 'proposed' &&
    pending.proposedByUserId !== viewerUserId &&
    pending.sentAt !== null
  ) {
    candidates.push(pending.sentAt);
  }
  if (
    lastDecided !== null &&
    lastDecided.proposedByUserId === viewerUserId &&
    lastDecided.decidedAt !== null
  ) {
    candidates.push(lastDecided.decidedAt);
  }
  if (row.endNoticedAt !== null && row.endedByUserId !== viewerUserId) {
    candidates.push(row.endNoticedAt);
  }
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates.map((at) => at.getTime())));
};

const hasNewsFor = (row: ContractWithContext, viewerUserId: string) => {
  const newsAt = newsAtFor(row, viewerUserId);
  if (newsAt === null) return false;
  const seenAt = sideOf(row, viewerUserId) === 'family' ? row.familySeenAt : row.providerSeenAt;
  return newsAt > (seenAt ?? new Date(0));
};

const toTermsResponse = (version: ContractVersion, viewerUserId: string, expiryDays: number) => ({
  versionId: version.id,
  version: version.version,
  status: version.status,
  proposedByMe: version.proposedByUserId === viewerUserId,
  services: version.services,
  startsOn: version.startsOn,
  endsOn: version.endsOn,
  weeklyEstimateCents: weeklyEstimateCents(version.services),
  currency: version.services[0]?.currency ?? 'CAD',
  sentAt: version.sentAt?.toISOString() ?? null,
  expiresAt:
    version.status === 'proposed' && version.sentAt !== null
      ? new Date(version.sentAt.getTime() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
      : null,
  decidedAt: version.decidedAt?.toISOString() ?? null,
  declineReason: version.declineReason
});

const counterpartResponse = (row: ContractWithContext, viewerUserId: string) => ({
  userId: row.counterpartUserId,
  name: displayName(
    { firstName: row.counterpartFirstName, lastName: row.counterpartLastName },
    'Poppynz member'
  ),
  city: row.counterpartCity,
  role: (sideOf(row, viewerUserId) === 'family' ? 'service-provider' : 'family') as
    | 'family'
    | 'service-provider'
});

export const toContractListItem = (
  row: ContractWithContext,
  viewerUserId: string,
  cutoff: Date
) => {
  const visible = visibleVersionsFor(row.versions, viewerUserId);
  const pending = pendingOf(row.versions);
  const accepted = acceptedOf(visible);
  const termsSource = accepted ?? pendingOf(visible) ?? visible[visible.length - 1] ?? null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    status: presentedContractStatus(row, pending, accepted, cutoff),
    awaitingYou:
      pending?.status === 'proposed' &&
      pending.proposedByUserId !== viewerUserId &&
      !isExpired(pending, cutoff),
    hasNews: hasNewsFor(row, viewerUserId),
    counterpart: counterpartResponse(row, viewerUserId),
    serviceNames: (termsSource?.services ?? []).map((service) => service.name),
    weeklyEstimateCents: termsSource !== null ? weeklyEstimateCents(termsSource.services) : null,
    currency: termsSource?.services[0]?.currency ?? 'CAD',
    endsOn: effectiveEndsOn(row, accepted),
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString()
  };
};

/** The chat pill's data: a compact summary of the conversation's contract for
 * the thread payload — chat renders contract state, it never stores it. */
export const toThreadContractSummary = (
  contract: Contract,
  versions: Array<ContractVersion>,
  viewerUserId: string,
  cutoff: Date
) => {
  if (!isParticipant(contract, viewerUserId) || hiddenFromViewer(contract, viewerUserId))
    return null;
  const visible = visibleVersionsFor(versions, viewerUserId);
  const pending = pendingOf(versions);
  const accepted = acceptedOf(visible);
  const termsSource = accepted ?? pendingOf(visible) ?? visible[visible.length - 1] ?? null;
  return {
    id: contract.id,
    status: presentedContractStatus(contract, pending, accepted, cutoff),
    awaitingYou:
      pending?.status === 'proposed' &&
      pending.proposedByUserId !== viewerUserId &&
      !isExpired(pending, cutoff),
    endsOn: effectiveEndsOn(contract, accepted),
    weeklyEstimateCents: termsSource ? weeklyEstimateCents(termsSource.services) : null
  };
};

// ---------------------------------------------------------------------------
// Domain programs

const loadParticipantContract = (contractId: string, viewerUserId: string) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const contract = yield* contractRepo
      .findById(contractId)
      .pipe((errors) => mapContractRepoError(errors));
    if (
      !contract ||
      !isParticipant(contract, viewerUserId) ||
      hiddenFromViewer(contract, viewerUserId)
    ) {
      return yield* Effect.fail(new ContractNotFoundError());
    }
    return contract;
  });

const loadPendingVersion = (contractId: string) =>
  ContractRepo.pipe(
    Effect.flatMap((repo) => repo.listVersions(contractId)),
    (errors) => mapContractRepoError(errors),
    Effect.map((versions) => ({ versions, pending: pendingOf(versions) }))
  );

/** Validates requested line items against the provider's current listing and
 * snapshots name/listed-rate/currency. Unknown ids 422; below-floor rates 422
 * with the offending rows. */
const snapshotTerms = (providerUserId: string, input: ContractTermsInput) =>
  Effect.gen(function* () {
    const listed = yield* ServiceOfferedRepo.pipe(
      Effect.flatMap((repo) => repo.listByUserId(providerUserId)),
      (errors) => mapContractRepoError(errors)
    );
    const listedById = new Map(listed.map((service) => [service.id, service]));
    const seen = new Set<string>();
    const services: Array<ContractServiceItem> = [];
    const violations: Array<{ serviceId: string; listedRateCents: number }> = [];
    for (const item of input.services) {
      const service = listedById.get(item.serviceId);
      if (!service || seen.has(item.serviceId)) {
        return yield* Effect.fail(new UnknownContractServiceError());
      }
      seen.add(item.serviceId);
      if (item.rateCents < minAllowedRateCents(service.hourlyRateCents)) {
        violations.push({ serviceId: service.id, listedRateCents: service.hourlyRateCents });
        continue;
      }
      services.push({
        serviceId: service.id,
        name: service.name,
        listedRateCents: service.hourlyRateCents,
        rateCents: item.rateCents,
        currency: service.currency,
        // Copy out of the validated input so the snapshot owns its rows.
        sessions: item.sessions.map((session) => ({ ...session })),
        expectations: item.expectations
      });
    }
    if (violations.length > 0) {
      return yield* Effect.fail(new RateBelowListedError({ violations }));
    }
    return services;
  });

export const createContractProgram = (
  userAndSession: UserAndSession,
  input: { conversationId: string }
) =>
  Effect.gen(function* () {
    const conversationRepo = yield* ConversationRepo;
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;

    const conversation = yield* conversationRepo
      .findById(input.conversationId)
      .pipe((errors) => mapContractRepoError(errors));
    if (
      !conversation ||
      (conversation.familyUserId !== viewer.id && conversation.providerUserId !== viewer.id)
    ) {
      return yield* Effect.fail(new ContractNotFoundError());
    }
    // The structural gate: only the conversation's family participant may
    // create, and only while the conversation is unlocked. Role is irrelevant.
    if (conversation.familyUserId !== viewer.id) {
      return yield* Effect.fail(new NotContractFamilyError());
    }
    if (conversation.status !== 'active') {
      return yield* Effect.fail(new ContractConversationNotActiveError());
    }

    const existing = yield* contractRepo
      .findByConversationId(conversation.id)
      .pipe((errors) => mapContractRepoError(errors));
    if (existing) {
      return yield* Effect.fail(new ContractExistsError({ contractId: existing.id }));
    }

    const created = yield* contractRepo
      .create({
        conversationId: conversation.id,
        familyUserId: conversation.familyUserId,
        providerUserId: conversation.providerUserId
      })
      .pipe(
        // The check-then-insert above is not atomic: a duplicate submit loses
        // the partial unique index race. Surface it as the same 409 the check
        // would have produced, not a 500.
        Effect.catchTag('SqlError', (cause) =>
          isUniqueViolation(cause)
            ? contractRepo.findByConversationId(conversation.id).pipe(
                (errors) => mapContractRepoError(errors),
                Effect.flatMap((winner) =>
                  Effect.fail(
                    winner
                      ? new ContractExistsError({ contractId: winner.id })
                      : new ContractRepoError({ cause })
                  )
                )
              )
            : Effect.fail(new ContractRepoError({ cause }))
        )
      );

    // No notification: a draft is family-private until it is sent.
    return { id: created.contract.id };
  });

export const saveTermsProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  input: ContractTermsInput
) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);
    if (sideOf(contract, viewer.id) !== 'family') {
      return yield* Effect.fail(new NotContractActorError());
    }
    if (
      contract.status !== 'draft' &&
      contract.status !== 'declined' &&
      contract.status !== 'changes_requested'
    ) {
      return yield* Effect.fail(new ContractStateError());
    }

    const services = yield* snapshotTerms(contract.providerUserId, input);
    const { versions, pending } = yield* loadPendingVersion(contractId);

    if (pending !== null && pending.status === 'proposed') {
      // A sent proposal is immutable — the family withdraws first (the UI's
      // "Edit proposal" does exactly that).
      return yield* Effect.fail(new ContractStateError());
    }

    const terms = {
      services,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null
    };

    if (pending !== null) {
      const updated = yield* contractRepo
        .updateVersionTerms(pending.id, terms)
        .pipe((errors) => mapContractRepoError(errors));
      if (!updated) {
        return yield* Effect.fail(new ContractStateError());
      }
      return { id: contract.id, version: updated.version };
    }

    // Revising after a decline / changes request starts the next version.
    const nextVersion = (versions[versions.length - 1]?.version ?? 0) + 1;
    const created = yield* contractRepo
      .createVersion({
        contractId,
        version: nextVersion,
        proposedByUserId: viewer.id,
        status: 'draft',
        ...terms
      })
      .pipe((errors) => mapVersionInsertError(errors));
    return { id: contract.id, version: created.version };
  });

export const sendContractProgram = (userAndSession: UserAndSession, contractId: string) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);
    if (sideOf(contract, viewer.id) !== 'family') {
      return yield* Effect.fail(new NotContractActorError());
    }
    if (
      contract.status !== 'draft' &&
      contract.status !== 'declined' &&
      contract.status !== 'changes_requested'
    ) {
      return yield* Effect.fail(new ContractStateError());
    }
    const { pending } = yield* loadPendingVersion(contractId);
    if (pending === null || pending.status !== 'draft') {
      return yield* Effect.fail(new ContractStateError());
    }
    if (pending.services.length === 0) {
      return yield* Effect.fail(new EmptyContractTermsError());
    }

    // The floor is re-checked against the provider's CURRENT listing at send
    // time — a draft that sat while the provider raised rates must be revised,
    // not slipped through. Rates on delisted services keep their snapshot, as
    // do items whose listing switched currency (cents in different currencies
    // are not comparable).
    const listed = yield* ServiceOfferedRepo.pipe(
      Effect.flatMap((repo) => repo.listByUserId(contract.providerUserId)),
      (errors) => mapContractRepoError(errors)
    );
    const listedById = new Map(listed.map((service) => [service.id, service]));
    const violations: Array<{ serviceId: string; listedRateCents: number }> = [];
    const refreshed = pending.services.map((item) => {
      const current = listedById.get(item.serviceId);
      if (!current || current.currency !== item.currency) return item;
      if (item.rateCents < minAllowedRateCents(current.hourlyRateCents)) {
        violations.push({ serviceId: item.serviceId, listedRateCents: current.hourlyRateCents });
      }
      return { ...item, listedRateCents: current.hourlyRateCents };
    });
    if (violations.length > 0) {
      return yield* Effect.fail(new RateBelowListedError({ violations }));
    }

    yield* contractRepo
      .updateVersionTerms(pending.id, {
        services: refreshed,
        startsOn: pending.startsOn,
        endsOn: pending.endsOn
      })
      .pipe((errors) => mapContractRepoError(errors));
    const sent = yield* contractRepo
      .sendPendingVersion(contractId, pending.id)
      .pipe((errors) => mapContractRepoError(errors));
    if (!sent) {
      return yield* Effect.fail(new ContractStateError());
    }

    const senderProfile = yield* loadProfileOrNull(viewer.id);
    yield* publishNotificationBestEffort(contract.providerUserId, {
      type: 'contract.proposed',
      payload: {
        contractId,
        counterpartName: displayName(senderProfile, viewer.name)
      }
    });

    return { id: contract.id, status: 'proposed' as const, version: sent.version };
  });

export const withdrawContractProgram = (userAndSession: UserAndSession, contractId: string) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);
    const { versions, pending } = yield* loadPendingVersion(contractId);
    if (pending === null || pending.status !== 'proposed') {
      return yield* Effect.fail(new ContractStateError());
    }

    if (sideOf(contract, viewer.id) !== 'family') {
      return yield* Effect.fail(new NotContractActorError());
    }
    if (contract.status !== 'proposed') {
      return yield* Effect.fail(new ContractStateError());
    }
    // The contract falls back to what the negotiation last looked like before
    // this proposal: a fresh draft, or the prior declined / changes-requested
    // state a revision was answering.
    const lastDecided = latestDecidedOf(versions.filter((version) => version.id !== pending.id));
    const restored =
      lastDecided?.status === 'declined' || lastDecided?.status === 'changes_requested'
        ? lastDecided.status
        : ('draft' as const);
    const withdrawn = yield* contractRepo
      .withdrawPendingVersion(contractId, pending.id, restored)
      .pipe((errors) => mapContractRepoError(errors));
    if (!withdrawn) {
      return yield* Effect.fail(new ContractStateError());
    }
    // Deliberately no notification: an undedecided proposal disappears quietly.
    return { id: contract.id, status: restored };
  });

export const acceptContractProgram = (userAndSession: UserAndSession, contractId: string) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);
    const { pending } = yield* loadPendingVersion(contractId);
    if (pending === null || pending.status !== 'proposed') {
      return yield* Effect.fail(new ContractStateError());
    }
    if (pending.proposedByUserId === viewer.id) {
      return yield* Effect.fail(new NotContractActorError());
    }
    if (contract.status !== 'proposed') {
      return yield* Effect.fail(new ContractStateError());
    }
    const { cutoff } = yield* contractProposalContext;
    if (isExpired(pending, cutoff)) {
      return yield* Effect.fail(new ContractProposalExpiredError());
    }

    // Supersede + accept + activate run in one transaction — a concurrent
    // decline can never leave the contract without an accepted version.
    const accepted = yield* contractRepo
      .acceptPendingVersion(contractId, pending.id, { activate: true })
      .pipe((errors) => mapContractRepoError(errors));
    if (!accepted) {
      return yield* Effect.fail(new ContractStateError());
    }

    const accepterProfile = yield* loadProfileOrNull(viewer.id);
    yield* publishNotificationBestEffort(pending.proposedByUserId, {
      type: 'contract.accepted',
      payload: {
        contractId,
        counterpartName: displayName(accepterProfile, viewer.name)
      }
    });

    return { id: contract.id, status: 'active' as const };
  });

export const declineContractProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  input: { reason?: string | null }
) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);
    const { pending } = yield* loadPendingVersion(contractId);
    if (pending === null || pending.status !== 'proposed') {
      return yield* Effect.fail(new ContractStateError());
    }
    if (pending.proposedByUserId === viewer.id) {
      return yield* Effect.fail(new NotContractActorError());
    }
    if (contract.status !== 'proposed') {
      return yield* Effect.fail(new ContractStateError());
    }

    const reason = input.reason?.trim() ? input.reason.trim() : null;
    // Declining closes the negotiation; the family may still revise and
    // re-send.
    const declined = yield* contractRepo
      .decidePendingVersion(contractId, pending.id, {
        status: 'declined',
        declineReason: reason,
        contractStatus: 'declined'
      })
      .pipe((errors) => mapContractRepoError(errors));
    if (!declined) {
      return yield* Effect.fail(new ContractStateError());
    }

    const declinerProfile = yield* loadProfileOrNull(viewer.id);
    yield* publishNotificationBestEffort(pending.proposedByUserId, {
      type: 'contract.declined',
      payload: {
        contractId,
        counterpartName: displayName(declinerProfile, viewer.name),
        reason
      }
    });

    return { id: contract.id, status: 'declined' as const };
  });

export const requestChangesProgram = (userAndSession: UserAndSession, contractId: string) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);
    if (sideOf(contract, viewer.id) !== 'provider') {
      return yield* Effect.fail(new NotContractActorError());
    }
    // "Request changes" is the provider steering the negotiation back to chat
    // — the family revises and re-sends the next version.
    if (contract.status !== 'proposed') {
      return yield* Effect.fail(new ContractStateError());
    }
    const { pending } = yield* loadPendingVersion(contractId);
    if (pending === null || pending.status !== 'proposed') {
      return yield* Effect.fail(new ContractStateError());
    }

    const decided = yield* contractRepo
      .decidePendingVersion(contractId, pending.id, {
        status: 'changes_requested',
        contractStatus: 'changes_requested'
      })
      .pipe((errors) => mapContractRepoError(errors));
    if (!decided) {
      return yield* Effect.fail(new ContractStateError());
    }

    const requesterProfile = yield* loadProfileOrNull(viewer.id);
    yield* publishNotificationBestEffort(contract.familyUserId, {
      type: 'contract.changes_requested',
      payload: {
        contractId,
        counterpartName: displayName(requesterProfile, viewer.name)
      }
    });

    // conversationId lets the client deep-link straight back into the chat.
    return {
      id: contract.id,
      status: 'changes_requested' as const,
      conversationId: contract.conversationId
    };
  });

export const endContractProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  input: { note?: string | null }
) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);

    const note = input.note?.trim() ? input.note.trim() : null;
    const updated = yield* contractRepo
      .setEnding(contractId, { endedByUserId: viewer.id, endNote: note })
      .pipe((errors) => mapContractRepoError(errors));
    if (!updated) {
      return yield* Effect.fail(new ContractStateError());
    }
    // Derived, not stored — the same computation every read applies.
    const endsOn = noticeEndsOn(updated) ?? todayIsoDate();

    const enderProfile = yield* loadProfileOrNull(viewer.id);
    const recipientUserId =
      contract.familyUserId === viewer.id ? contract.providerUserId : contract.familyUserId;
    yield* publishNotificationBestEffort(recipientUserId, {
      type: 'contract.ended',
      payload: {
        contractId,
        counterpartName: displayName(enderProfile, viewer.name),
        endsOn
      }
    });

    return { id: contract.id, status: 'ending' as const, endsOn };
  });

export const markContractSeenProgram = (userAndSession: UserAndSession, contractId: string) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);
    yield* contractRepo
      .markSeen(contractId, sideOf(contract, viewer.id), new Date())
      .pipe((errors) => mapContractRepoError(errors));
    return { ok: true as const };
  });

export const listContractsProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;
    const { cutoff } = yield* contractProposalContext;
    const rows = yield* contractRepo
      .listForUser(viewer.id)
      .pipe((errors) => mapContractRepoError(errors));
    const visible = rows.filter((row) => !hiddenFromViewer(row, viewer.id));
    return {
      contracts: visible.map((row) => toContractListItem(row, viewer.id, cutoff))
    };
  });

export const contractsBadgeCountProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;
    const rows = yield* contractRepo
      .listForUser(viewer.id)
      .pipe((errors) => mapContractRepoError(errors));
    const total = rows.filter(
      (row) => !hiddenFromViewer(row, viewer.id) && hasNewsFor(row, viewer.id)
    ).length;
    return { total };
  });

export const getContractProgram = (userAndSession: UserAndSession, contractId: string) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const conversationRepo = yield* ConversationRepo;
    const userRepo = yield* UserRepo;
    const viewer = userAndSession.user;
    const row = yield* contractRepo
      .findWithContext(contractId, viewer.id)
      .pipe((errors) => mapContractRepoError(errors));
    if (!row || !isParticipant(row, viewer.id) || hiddenFromViewer(row, viewer.id)) {
      return yield* Effect.fail(new ContractNotFoundError());
    }

    const { cutoff, expiryDays } = yield* contractProposalContext;
    const viewerSide = sideOf(row, viewer.id);
    const pending = pendingOf(row.versions);
    const accepted = acceptedOf(row.versions);
    const presented = presentedContractStatus(row, pending, accepted, cutoff);

    const conversation = yield* conversationRepo
      .findById(row.conversationId)
      .pipe((errors) => mapContractRepoError(errors));

    // The composer's privacy promise: contact details stay hidden until the
    // contract is active (and stay visible through ending/ended).
    let counterpartContact: { email: string; phone: string | null } | null = null;
    if (presented === 'active' || presented === 'ending' || presented === 'ended') {
      const counterpartUser = yield* userRepo.findById(row.counterpartUserId).pipe(
        Effect.catchTags({
          DBNotFoundError: () => Effect.succeed(null),
          SqlError: (cause) => Effect.fail(new ContractRepoError({ cause }))
        })
      );
      const counterpartProfile = yield* loadProfileOrNull(row.counterpartUserId);
      counterpartContact = counterpartUser
        ? {
            email: counterpartUser.email,
            phone: counterpartProfile?.phoneNumber ?? counterpartUser.phoneNumber ?? null
          }
        : null;
    }

    const isFamily = viewerSide === 'family';
    const preActiveEditable =
      row.status === 'draft' || row.status === 'declined' || row.status === 'changes_requested';
    const isReceiverOfPending =
      pending?.status === 'proposed' && pending.proposedByUserId !== viewer.id;
    const decidable = isReceiverOfPending && row.status === 'proposed';

    // Draft versions are visible only to their proposer (belt and braces — a
    // provider already 404s on a draft-only contract).
    const visibleVersions = row.versions.filter(
      (version) => version.status !== 'draft' || version.proposedByUserId === viewer.id
    );
    const pendingVisible =
      pending !== null && (pending.status !== 'draft' || pending.proposedByUserId === viewer.id);

    return {
      contract: {
        id: row.id,
        conversationId: row.conversationId,
        conversationStartedAt: conversation?.createdAt.toISOString() ?? null,
        status: presented,
        viewerSide,
        counterpart: counterpartResponse(row, viewer.id),
        counterpartContact,
        acceptedVersion:
          accepted !== null ? toTermsResponse(accepted, viewer.id, expiryDays) : null,
        pendingVersion:
          pendingVisible && pending !== null
            ? toTermsResponse(pending, viewer.id, expiryDays)
            : null,
        // Newest visible terms regardless of outcome — the declined view keeps
        // the terms dimmed for context, and a revision pre-fills from them.
        latestVersion:
          visibleVersions.length > 0
            ? toTermsResponse(visibleVersions[visibleVersions.length - 1], viewer.id, expiryDays)
            : null,
        versions: visibleVersions.map((version) => ({
          version: version.version,
          status: version.status,
          proposedByMe: version.proposedByUserId === viewer.id,
          sentAt: version.sentAt?.toISOString() ?? null,
          decidedAt: version.decidedAt?.toISOString() ?? null,
          declineReason: version.declineReason
        })),
        endsOn: effectiveEndsOn(row, accepted),
        endedByMe: row.endedByUserId === viewer.id,
        endNote: row.endNote,
        endNoticedAt: row.endNoticedAt?.toISOString() ?? null,
        actions: {
          canEditTerms: isFamily && preActiveEditable,
          canSend: isFamily && preActiveEditable && pending?.status === 'draft',
          canWithdraw: isFamily && row.status === 'proposed',
          canAccept: decidable && !isExpired(pending, cutoff),
          canDecline: decidable,
          canRequestChanges: !isFamily && row.status === 'proposed' && isReceiverOfPending,
          // Presented, not stored: a contract already past its negotiated end
          // date can't be given notice.
          canEnd: presented === 'active'
        },
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      }
    };
  });

// ---------------------------------------------------------------------------
// Route programs (parse + validate + authenticate + authorize + domain)

export const createContractRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, contractCreateJsonError);
    const input = yield* validateContractCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['write'] })(
      authenticated
    );
    return yield* createContractProgram(userAndSession, input);
  });

export const listContractsRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['read'] })(
      authenticated
    );
    return yield* listContractsProgram(userAndSession);
  });

export const contractsBadgeCountRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['read'] })(
      authenticated
    );
    return yield* contractsBadgeCountProgram(userAndSession);
  });

export const getContractRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['read'] })(
      authenticated
    );
    return yield* getContractProgram(userAndSession, contractId);
  });

export const saveTermsRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const rawBody = yield* parseJsonBody(c, contractTermsJsonError);
    const input = yield* validateContractTermsInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['write'] })(
      authenticated
    );
    return yield* saveTermsProgram(userAndSession, contractId, input);
  });

export const sendContractRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['write'] })(
      authenticated
    );
    return yield* sendContractProgram(userAndSession, contractId);
  });

export const withdrawContractRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['write'] })(
      authenticated
    );
    return yield* withdrawContractProgram(userAndSession, contractId);
  });

export const acceptContractRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['write'] })(
      authenticated
    );
    return yield* acceptContractProgram(userAndSession, contractId);
  });

export const declineContractRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const rawBody = yield* parseJsonBody(c, contractDeclineJsonError);
    const input = yield* validateContractDeclineInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['write'] })(
      authenticated
    );
    return yield* declineContractProgram(userAndSession, contractId, input);
  });

export const requestChangesRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['write'] })(
      authenticated
    );
    return yield* requestChangesProgram(userAndSession, contractId);
  });

export const endContractRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const rawBody = yield* parseJsonBody(c, contractEndJsonError);
    const input = yield* validateContractEndInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['write'] })(
      authenticated
    );
    return yield* endContractProgram(userAndSession, contractId, input);
  });

export const markContractSeenRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['write'] })(
      authenticated
    );
    return yield* markContractSeenProgram(userAndSession, contractId);
  });

export type ContractRouteError =
  | Effect.Effect.Error<ReturnType<typeof createContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listContractsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof contractsBadgeCountRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof saveTermsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof sendContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof withdrawContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof acceptContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof declineContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof requestChangesRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof endContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof markContractSeenRouteProgram>>;

const contractRouteErrorToResponse = (c: HonoContext<HonoEnv>, error: ContractRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'ContractRepoError':
      return c.json(
        {
          error: {
            code: 'CONTRACT_LOOKUP_FAILED' as const,
            message: 'Unable to process the contract.'
          }
        },
        500
      );
    case 'ContractNotFoundError':
      return c.json(
        { error: { code: 'CONTRACT_NOT_FOUND' as const, message: 'Contract not found.' } },
        404
      );
    case 'NotContractFamilyError':
      return c.json(
        {
          error: {
            code: 'NOT_CONTRACT_FAMILY' as const,
            message: 'Only the family in this conversation can propose a contract.'
          }
        },
        403
      );
    case 'ContractConversationNotActiveError':
      return c.json(
        {
          error: {
            code: 'CONVERSATION_NOT_ACTIVE' as const,
            message: 'Contracts start from an active conversation.'
          }
        },
        409
      );
    case 'ContractExistsError':
      return c.json(
        {
          error: {
            code: 'CONTRACT_EXISTS' as const,
            message: 'You already have a contract with this person.',
            contractId: error.contractId
          }
        },
        409
      );
    case 'UnknownContractServiceError':
      return c.json(
        {
          error: {
            code: 'UNKNOWN_CONTRACT_SERVICE' as const,
            message: "Pick services from this provider's current list."
          }
        },
        422
      );
    case 'RateBelowListedError':
      return c.json(
        {
          error: {
            code: 'RATE_BELOW_LISTED' as const,
            message: "Rates start at half the provider's listed rate — you can always offer more.",
            violations: error.violations
          }
        },
        422
      );
    case 'EmptyContractTermsError':
      return c.json(
        {
          error: {
            code: 'EMPTY_CONTRACT_TERMS' as const,
            message: 'Add at least one service before sending.'
          }
        },
        422
      );
    case 'ContractStateError':
      return c.json(
        {
          error: {
            code: 'CONTRACT_STATE_INVALID' as const,
            message: 'This contract has moved on — reload to see its current state.'
          }
        },
        409
      );
    case 'NotContractActorError':
      return c.json(
        {
          error: {
            code: 'NOT_CONTRACT_ACTOR' as const,
            message: "You can't do this on this contract."
          }
        },
        403
      );
    case 'ContractProposalExpiredError':
      return c.json(
        {
          error: {
            code: 'CONTRACT_PROPOSAL_EXPIRED' as const,
            message: 'This proposal has expired — ask for new terms instead.'
          }
        },
        409
      );
    default:
      return handleNever(c, error);
  }
};

const unexpectedErrorResponse = (c: HonoContext<HonoEnv>) =>
  c.json(
    { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
    500
  );

const exitToResponse = <TData>(
  c: HonoContext<HonoEnv>,
  exit: Exit.Exit<TData, ContractRouteError>
) =>
  Exit.match(exit, {
    onSuccess: (data) => c.json(data),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return contractRouteErrorToResponse(c, failure.value);
      }
      return unexpectedErrorResponse(c);
    }
  });

export async function createContractHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(createContractRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function listContractsHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(listContractsRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function contractsBadgeCountHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(contractsBadgeCountRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function getContractHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(getContractRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function saveTermsHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(saveTermsRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function sendContractHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(sendContractRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function withdrawContractHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(withdrawContractRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function acceptContractHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(acceptContractRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function declineContractHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(declineContractRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function requestChangesHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(requestChangesRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function endContractHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(endContractRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function markContractSeenHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(markContractSeenRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}
