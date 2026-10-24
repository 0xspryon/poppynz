import type { SqlError } from '@effect/sql/SqlError';
import {
  cardOnFile,
  contractBillingPolicy,
  effectiveEnd,
  effectiveEndsOn,
  isPaymentReady,
  loadTaxSnapshot,
  newContractBilling,
  startContractBilling
} from '@repo/billing';
import {
  applyBps,
  computeSupplyTax,
  normaliseProvince,
  weeklyServiceCents,
  type ProvinceCode,
  type TaxSnapshot
} from '@repo/billing/pricing';
import {
  ContractBillingRepo,
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
import { addDays, todayIn, zoneLabel } from '@repo/calendar';
import { zoneForLocation } from '@repo/calendar/lookup';
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
import {
  requireVerifiedSafety,
  safetyVerificationGateUnavailableResponseBody,
  safetyVerificationRequiredResponseBody
} from '@/api/lib/safety-verification-gate';
import {
  approvalGateUnavailableResponseBody,
  approvalRequiredResponseBody,
  requireCounterpartApproval,
  requireLiveApproval,
  CounterpartNotApprovedError
} from '@/api/lib/approval-gate';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import { hasReadyPayoutAccount } from '@/api/lib/payouts';
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

/** Sending needs a start date — billing cycles are anchored to it. `action`
 * picks the copy: the sender is told to pick one, the receiver of a (dev-data)
 * proposal without one is told to ask for new terms. */
export class StartDateRequiredError extends Data.TaggedError('StartDateRequiredError')<{
  action: 'send' | 'accept';
}> {}

/** The contract's zone comes from the family's location; without an address
 * there is no zone to read dates and session times in. */
export class FamilyLocationRequiredError extends Data.TaggedError(
  'FamilyLocationRequiredError'
)<{}> {}

/** The start date must be later than today in the family's zone. */
export class StartDateNotInFutureError extends Data.TaggedError('StartDateNotInFutureError')<{}> {}

/** Acceptance is refused on or after the start date — cycle 1 must begin
 * after the contract is accepted. */
export class ContractStartDatePassedError extends Data.TaggedError(
  'ContractStartDatePassedError'
)<{}> {}

/** Sales tax on the fees depends on where each side is (piece 3 spec §3a):
 * without a province the terms can't be priced, so they can't be sent or
 * accepted. `viewerIsParty` picks the copy. */
export class ContractProvinceRequiredError extends Data.TaggedError(
  'ContractProvinceRequiredError'
)<{ party: 'family' | 'helper'; viewerIsParty: boolean }> {}

/** Sending terms needs a card on file — contract billing charges it. */
export class PaymentMethodRequiredError extends Data.TaggedError(
  'PaymentMethodRequiredError'
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

/** The family's zone from their saved coordinates, or null without them. */
const familyTimeZone = (familyUserId: string) =>
  loadProfileOrNull(familyUserId).pipe(
    Effect.map((profile) =>
      profile?.latitude != null && profile.longitude != null
        ? zoneForLocation(profile.latitude, profile.longitude)
        : null
    )
  );

/** A member's province from their profile address (Canada only), or null. */
const profileProvince = (userId: string) =>
  loadProfileOrNull(userId).pipe(
    Effect.map((profile) => normaliseProvince(profile?.stateProvince, profile?.country))
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

/** Contract dates are calendar dates in the version's own zone (the
 * family's, frozen at acceptance). Null only for a draft, which has no zone. */
const contractToday = (version: ContractVersion): string | null =>
  version.timeZone ? todayIn(version.timeZone) : null;

/** On or after the start date in the version's zone. A sent version with no
 * start date has not *passed* one — accept refuses it as START_DATE_REQUIRED
 * and the detail view just withholds `canAccept` (development data only; send
 * always requires one). A sent version without a zone can't be accepted
 * either (the CHECK constraint makes that impossible for real rows). */
const startDatePassed = (version: ContractVersion) => {
  if (version.startsOn === null) return false;
  const today = contractToday(version);
  return today === null || today >= version.startsOn;
};

/** A sent, undecided proposal that can no longer be accepted by the passage
 * of time: past the expiry window, or its start date has arrived in its zone.
 * Either way it presents as expired (read-time only, never written back),
 * stops awaiting the receiver and stops being news for them. The single
 * source for the detail, list, chat pill and badge so they can't disagree. */
const proposalLapsed = (pending: ContractVersion | null, cutoff: Date) =>
  pending !== null &&
  pending.status === 'proposed' &&
  (isExpired(pending, cutoff) || startDatePassed(pending));

// When a contract stops working is shared with billing (@repo/billing).
export { effectiveEnd, effectiveEndsOn };

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
 * pre-active proposal past the expiry window or its start date presents as
 * expired — neither is ever written back. */
export const presentedContractStatus = (
  contract: Contract,
  pending: ContractVersion | null,
  accepted: ContractVersion | null,
  cutoff: Date
): PresentedContractStatus => {
  // Strictly past: the effective end date is the LAST WORKING day — the
  // contract is still running (payments running) for the whole of it.
  const endsOn = effectiveEndsOn(contract, accepted);
  const today = accepted !== null ? contractToday(accepted) : null;
  if (
    (contract.status === 'ending' || contract.status === 'active') &&
    endsOn !== null &&
    today !== null &&
    endsOn < today
  ) {
    return 'ended';
  }
  if (contract.status === 'proposed' && proposalLapsed(pending, cutoff)) {
    return 'expired';
  }
  return contract.status;
};

/** A family-private draft (never sent, or withdrawn before any decision) is
 * invisible to the provider. The contract-status invariant makes this a
 * one-liner: status is "draft" exactly when no version was ever decided. */
const hiddenFromViewer = (contract: Contract, viewerUserId: string) =>
  contract.status === 'draft' && contract.providerUserId === viewerUserId;

/** The newest thing the viewer hasn't been told about yet. A proposal that
 * has lapsed (expiry window or start date — it presents as expired) is no
 * longer news for its receiver: there is nothing left for them to act on. */
const newsAtFor = (row: ContractWithContext, viewerUserId: string, cutoff: Date): Date | null => {
  const pending = pendingOf(row.versions);
  const lastDecided = latestDecidedOf(row.versions);
  const candidates: Array<Date> = [];
  if (
    pending?.status === 'proposed' &&
    pending.proposedByUserId !== viewerUserId &&
    pending.sentAt !== null &&
    !proposalLapsed(pending, cutoff)
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

const hasNewsFor = (row: ContractWithContext, viewerUserId: string, cutoff: Date) => {
  const newsAt = newsAtFor(row, viewerUserId, cutoff);
  if (newsAt === null) return false;
  const seenAt = sideOf(row, viewerUserId) === 'family' ? row.familySeenAt : row.providerSeenAt;
  return newsAt > (seenAt ?? new Date(0));
};

// ---------------------------------------------------------------------------
// Price breakdown and billing (piece 3)

type TaxLineView = { label: string; taxCents: number };

const taxLineViews = (
  lines: ReadonlyArray<{ label: string; taxCents: number }>
): Array<TaxLineView> => lines.map((line) => ({ label: line.label, taxCents: line.taxCents }));

type PricingInputs = {
  snapshot: TaxSnapshot;
  familyFeeBps: number;
  providerCommissionBps: number;
  familyProvince: ProvinceCode | null;
  helperProvince: ProvinceCode | null;
  side: ContractSide;
  /** Today in the zone the dates are read in, when known. */
  today: string | null;
};

/** One week of the pattern, priced for the viewer's side only: the family
 * sees the service fee and its tax added, the helper sees the commission and
 * its tax deducted. Rounded per session by the one rule billing uses. */
export const weeklyPricing = (version: ContractVersion, inputs: PricingInputs) => {
  const serviceCents = weeklyServiceCents(version.services);
  const on =
    version.startsOn && (inputs.today === null || version.startsOn > inputs.today)
      ? version.startsOn
      : (inputs.today ?? version.startsOn ?? new Date().toISOString().slice(0, 10));
  const provinces = {
    payer: inputs.familyProvince,
    contract: inputs.familyProvince,
    helper: inputs.helperProvince
  };
  const tax = (
    supplyType: 'care_service_value' | 'family_service_fee' | 'provider_commission',
    baseCents: number
  ) => computeSupplyTax({ snapshot: inputs.snapshot, supplyType, baseCents, on, provinces });
  const blocked = (error: { reason: string; placeOfSupply?: string }) => ({
    available: false as const,
    reason:
      error.reason === 'province_required'
        ? ('tax_province_required' as const)
        : ('tax_configuration_incomplete' as const),
    missingProvinceOf:
      error.reason !== 'province_required'
        ? null
        : error.placeOfSupply === 'helper_province'
          ? ('helper' as const)
          : ('family' as const)
  });
  const serviceTax = tax('care_service_value', serviceCents);
  if (!serviceTax.ok) return blocked(serviceTax.error);
  if (inputs.side === 'family') {
    const feeCents = applyBps(serviceCents, inputs.familyFeeBps);
    const feeTax = tax('family_service_fee', feeCents);
    if (!feeTax.ok) return blocked(feeTax.error);
    return {
      available: true as const,
      side: 'family' as const,
      period: 'week' as const,
      serviceCents,
      serviceTaxLines: taxLineViews(serviceTax.lines),
      feeBps: inputs.familyFeeBps,
      feeCents,
      feeTaxLines: taxLineViews(feeTax.lines),
      totalCents: serviceCents + serviceTax.taxCents + feeCents + feeTax.taxCents
    };
  }
  const commissionCents = applyBps(serviceCents, inputs.providerCommissionBps);
  const commissionTax = tax('provider_commission', commissionCents);
  if (!commissionTax.ok) return blocked(commissionTax.error);
  return {
    available: true as const,
    side: 'provider' as const,
    period: 'week' as const,
    serviceCents,
    serviceTaxLines: taxLineViews(serviceTax.lines),
    commissionBps: inputs.providerCommissionBps,
    commissionCents,
    commissionTaxLines: taxLineViews(commissionTax.lines),
    shareCents: serviceCents + serviceTax.taxCents - commissionCents - commissionTax.taxCents
  };
};

export type WeeklyPricing = ReturnType<typeof weeklyPricing>;

/** The contract's billing state and cycles, as the viewer may see them. */
const billingSummary = (contractId: string, side: ContractSide) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const billing = yield* repo
      .findBilling(contractId)
      .pipe((errors) => mapContractRepoError(errors));
    if (billing === null) return null;
    const [cycles, sessions] = yield* Effect.all([
      repo.listCycles(contractId).pipe((errors) => mapContractRepoError(errors)),
      repo.listSessions(contractId).pipe((errors) => mapContractRepoError(errors))
    ]);
    const familySupplies = ['care_service_value', 'family_service_fee'];
    const helperSupplies = ['care_service_value', 'provider_commission'];
    return {
      status: billing.status,
      suspendedReason: billing.suspendedReason,
      // Cancelled unless the helper is payment-ready by cycle 1's capture.
      readinessDeadline:
        billing.status === 'awaiting_payment_readiness'
          ? (cycles[0]?.captureAt.toISOString() ?? null)
          : null,
      feeBps: side === 'family' ? billing.familyFeeBps : billing.providerCommissionBps,
      cycles: cycles.map((cycle) => {
        const own = sessions.filter(
          (session) => session.cycleId === cycle.id && session.status !== 'cancelled'
        );
        const supplies = side === 'family' ? familySupplies : helperSupplies;
        return {
          id: cycle.id,
          index: cycle.index,
          startsOn: cycle.startsOn,
          endsOn: cycle.endsOn,
          status: cycle.status,
          holdAt: cycle.holdAt.toISOString(),
          captureAt: cycle.captureAt.toISOString(),
          transferAt: side === 'provider' ? cycle.transferAt.toISOString() : null,
          sessionCount: own.length,
          suspendedSessionCount: own.filter((session) => session.status === 'suspended').length,
          minutes: own.reduce((total, session) => total + session.elapsedMinutes, 0),
          // The family's charge (what was captured, once captured) or the
          // helper's share; null until the cycle is quoted.
          amountCents:
            side === 'family'
              ? (cycle.capturedCents ?? cycle.familyTotalCents)
              : cycle.providerShareCents,
          taxLines: taxLineViews(
            cycle.taxLines.filter((line) => supplies.includes(line.supplyType))
          )
        };
      })
    };
  });

const toTermsResponse = (
  version: ContractVersion,
  viewerUserId: string,
  expiryDays: number,
  pricing: WeeklyPricing | null = null
) => ({
  pricing,
  versionId: version.id,
  version: version.version,
  status: version.status,
  proposedByMe: version.proposedByUserId === viewerUserId,
  services: version.services,
  startsOn: version.startsOn,
  endsOn: version.endsOn,
  endsAtMinutes: version.endsAtMinutes,
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
      !proposalLapsed(pending, cutoff),
    hasNews: hasNewsFor(row, viewerUserId, cutoff),
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
      !proposalLapsed(pending, cutoff),
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

/** Contracts are bookings: the person on the other side must still hold a
 * live approval when terms are sent or accepted. */
const requireContractCounterpart = (counterpartUserId: string) =>
  UserRepo.pipe(
    Effect.flatMap((repo) => repo.findById(counterpartUserId)),
    Effect.catchTags({
      DBNotFoundError: () => Effect.fail(new CounterpartNotApprovedError()),
      SqlError: (cause) => Effect.fail(new ContractRepoError({ cause }))
    }),
    Effect.flatMap(requireCounterpartApproval)
  );

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
      endsOn: input.endsOn ?? null,
      // An end time only means something on a negotiated end date.
      endsAtMinutes: input.endsOn ? (input.endsAtMinutes ?? null) : null
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
    yield* requireContractCounterpart(contract.providerUserId);

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

    if (pending.startsOn === null) {
      return yield* Effect.fail(new StartDateRequiredError({ action: 'send' }));
    }
    // The zone is the family's, read now and frozen with the version at
    // acceptance — a later move never shifts a signed contract's dates.
    const timeZone = yield* familyTimeZone(contract.familyUserId);
    if (timeZone === null) {
      return yield* Effect.fail(new FamilyLocationRequiredError());
    }
    if (pending.startsOn <= todayIn(timeZone)) {
      return yield* Effect.fail(new StartDateNotInFutureError());
    }
    // The family service fee is taxed where the family is.
    if ((yield* profileProvince(contract.familyUserId)) === null) {
      return yield* Effect.fail(
        new ContractProvinceRequiredError({ party: 'family', viewerIsParty: true })
      );
    }

    // Contract billing charges the family's card, so terms only go out once
    // there is one on file. Checked last: every other problem with the draft
    // is something to fix in the editor first.
    const card = yield* cardOnFile(viewer.id).pipe((errors) => mapContractRepoError(errors));
    if (card === null) {
      return yield* Effect.fail(new PaymentMethodRequiredError());
    }

    // The validated terms and the zone are written in the same guarded
    // statement as the status flip, so a concurrent draft save can't slip
    // unvalidated terms into the proposal (it is overwritten by what was
    // checked here, or lands after and finds the version no longer a draft).
    const sent = yield* contractRepo
      .sendPendingVersion(contractId, pending.id, {
        services: refreshed,
        startsOn: pending.startsOn,
        endsOn: pending.endsOn,
        endsAtMinutes: pending.endsAtMinutes,
        timeZone
      })
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
    if (pending.startsOn === null) {
      return yield* Effect.fail(new StartDateRequiredError({ action: 'accept' }));
    }
    if (startDatePassed(pending)) {
      return yield* Effect.fail(new ContractStartDatePassedError());
    }
    yield* requireContractCounterpart(pending.proposedByUserId);

    // Billing (piece 3): both places of supply are frozen with the contract,
    // so both must be known — the family's for the fee, the helper's for the
    // commission.
    const viewerSide = sideOf(contract, viewer.id);
    const familyProvince = yield* profileProvince(contract.familyUserId);
    if (familyProvince === null) {
      return yield* Effect.fail(
        new ContractProvinceRequiredError({
          party: 'family',
          viewerIsParty: viewerSide === 'family'
        })
      );
    }
    const helperProvince = yield* profileProvince(contract.providerUserId);
    if (helperProvince === null) {
      return yield* Effect.fail(
        new ContractProvinceRequiredError({
          party: 'helper',
          viewerIsParty: viewerSide === 'provider'
        })
      );
    }
    if (pending.timeZone === null) {
      return yield* Effect.fail(new ContractStateError());
    }
    const acceptedAt = new Date();
    const billing = yield* newContractBilling({
      timeZone: pending.timeZone,
      startsOn: pending.startsOn,
      familyProvince,
      helperProvince,
      // Accepting never waits on payouts: a helper who isn't ready yet puts
      // the contract in the payment-readiness gate instead.
      helperReady: yield* isPaymentReady(contract.providerUserId),
      now: acceptedAt
    });

    // Supersede + accept + activate + the billing schedule run in one
    // transaction — a concurrent decline can never leave the contract without
    // an accepted version, nor an accepted contract without its billing.
    const accepted = yield* contractRepo
      .acceptPendingVersion(contractId, pending.id, { activate: true, billing })
      .pipe((errors) => mapContractRepoError(errors));
    if (!accepted) {
      return yield* Effect.fail(new ContractStateError());
    }

    // As soon as it is binding: the readiness reminder, and a late booking's
    // immediate charge. Never fails the acceptance — the tick catches up.
    yield* startContractBilling(contractId, acceptedAt).pipe(
      Effect.catchAllCause((cause) =>
        Effect.logError(`[billing] start after acceptance failed for ${contractId}`, cause)
      )
    );

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

    // The notice end date is read in the in-force terms' zone; an active
    // contract without accepted terms is not a state ending can apply to.
    const { versions } = yield* loadPendingVersion(contractId);
    const accepted = acceptedOf(versions);
    if (!accepted?.timeZone) {
      return yield* Effect.fail(new ContractStateError());
    }
    // Presented, not stored (matches the detail's `canEnd`): a contract already
    // past its effective end in its zone reads as ended and can't be given
    // notice, although its stored status may still say active.
    const endBefore = effectiveEndsOn(contract, accepted);
    if (endBefore !== null && endBefore < todayIn(accepted.timeZone)) {
      return yield* Effect.fail(new ContractStateError());
    }

    const note = input.note?.trim() ? input.note.trim() : null;
    const updated = yield* contractRepo
      .setEnding(contractId, { endedByUserId: viewer.id, endNote: note })
      .pipe((errors) => mapContractRepoError(errors));
    if (!updated) {
      return yield* Effect.fail(new ContractStateError());
    }
    // Derived, not stored — the same computation every read applies: the
    // earlier of the notice period and the negotiated end (with its end time).
    const effective = effectiveEnd(updated, accepted);
    const endsOn = effective?.endsOn ?? todayIn(accepted.timeZone);
    const endsAtMinutes = effective?.endsAtMinutes ?? null;

    const enderProfile = yield* loadProfileOrNull(viewer.id);
    const recipientUserId =
      contract.familyUserId === viewer.id ? contract.providerUserId : contract.familyUserId;
    yield* publishNotificationBestEffort(recipientUserId, {
      type: 'contract.ended',
      payload: {
        contractId,
        counterpartName: displayName(enderProfile, viewer.name),
        endsOn,
        endsAtMinutes
      }
    });

    return { id: contract.id, status: 'ending' as const, endsOn, endsAtMinutes };
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
    const { cutoff } = yield* contractProposalContext;
    const rows = yield* contractRepo
      .listForUser(viewer.id)
      .pipe((errors) => mapContractRepoError(errors));
    const total = rows.filter(
      (row) => !hiddenFromViewer(row, viewer.id) && hasNewsFor(row, viewer.id, cutoff)
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

    // The zone dates are shown in: while the family can still edit (draft,
    // declined, changes requested) it is the zone their CURRENT location gives
    // — that is what send will stamp, even if an older sent version carries
    // another zone. Otherwise the shown version's frozen zone.
    const shownVersion =
      accepted ??
      (pendingVisible ? pending : null) ??
      visibleVersions[visibleVersions.length - 1] ??
      null;
    const timeZone =
      isFamily && preActiveEditable
        ? yield* familyTimeZone(row.familyUserId)
        : shownVersion !== null && shownVersion.status !== 'draft' && shownVersion.timeZone
          ? shownVersion.timeZone
          : isFamily
            ? yield* familyTimeZone(row.familyUserId)
            : null;
    // Only the family pays, so only the family is told whether a card is on
    // file; for the provider it is null rather than a misleading false.
    const hasPaymentMethod = isFamily
      ? (yield* cardOnFile(viewer.id).pipe((errors) => mapContractRepoError(errors))) !== null
      : null;
    // The mirror for the helper (piece 2b): told whether payouts are ready,
    // for the reminder at acceptance; null for the family. Stored snapshot
    // only, and readiness never gates accepting — pieces 3 and 4 enforce it.
    const payoutsReady = isFamily ? null : yield* hasReadyPayoutAccount(viewer.id);

    // Piece 3: the price breakdown for the viewer's side (frozen rates and
    // provinces once accepted, current ones before), and the billing state.
    const billing = yield* billingSummary(row.id, viewerSide);
    const billingRow = yield* ContractBillingRepo.pipe(
      Effect.flatMap((repo) => repo.findBilling(row.id)),
      (errors) => mapContractRepoError(errors)
    );
    const policy = yield* contractBillingPolicy;
    const snapshot = yield* loadTaxSnapshot.pipe((errors) => mapContractRepoError(errors));
    const pricingInputs: PricingInputs = {
      snapshot,
      familyFeeBps: billingRow?.familyFeeBps ?? policy.familyCommissionBps,
      providerCommissionBps: billingRow?.providerCommissionBps ?? policy.providerCommissionBps,
      familyProvince: billingRow
        ? (billingRow.familyProvince as ProvinceCode)
        : yield* profileProvince(row.familyUserId),
      helperProvince: billingRow
        ? (billingRow.helperProvince as ProvinceCode)
        : yield* profileProvince(row.providerUserId),
      side: viewerSide,
      today: timeZone ? todayIn(timeZone) : null
    };
    const pricingOf = (version: ContractVersion) => weeklyPricing(version, pricingInputs);
    const effective = effectiveEnd(row, accepted);
    // Why the proposal can't be accepted, for both sides: the receiver's
    // Accept is gone, and the proposer is told to send a later start date.
    const acceptBlockedReason =
      row.status === 'proposed' && pending?.status === 'proposed' && startDatePassed(pending)
        ? ('start_date_passed' as const)
        : null;

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
          accepted !== null
            ? toTermsResponse(accepted, viewer.id, expiryDays, pricingOf(accepted))
            : null,
        pendingVersion:
          pendingVisible && pending !== null
            ? toTermsResponse(pending, viewer.id, expiryDays, pricingOf(pending))
            : null,
        // Newest visible terms regardless of outcome — the declined view keeps
        // the terms dimmed for context, and a revision pre-fills from them.
        latestVersion:
          visibleVersions.length > 0
            ? toTermsResponse(
                visibleVersions[visibleVersions.length - 1],
                viewer.id,
                expiryDays,
                pricingOf(visibleVersions[visibleVersions.length - 1])
              )
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
        endsAtMinutes: effective?.endsAtMinutes ?? null,
        timeZone,
        timeZoneLabel: timeZone ? zoneLabel(timeZone) : null,
        earliestStartsOn: timeZone ? addDays(todayIn(timeZone), 1) : null,
        acceptBlockedReason,
        hasPaymentMethod,
        payoutsReady,
        billing,
        endedByMe: row.endedByUserId === viewer.id,
        endNote: row.endNote,
        endNoticedAt: row.endNoticedAt?.toISOString() ?? null,
        actions: {
          canEditTerms: isFamily && preActiveEditable,
          // Send stamps the family's zone and needs a card on file; without
          // either it would refuse (FAMILY_LOCATION_REQUIRED /
          // PAYMENT_METHOD_REQUIRED), so it isn't offered.
          canSend:
            isFamily &&
            preActiveEditable &&
            pending?.status === 'draft' &&
            timeZone !== null &&
            hasPaymentMethod === true,
          canWithdraw: isFamily && row.status === 'proposed',
          canAccept:
            decidable &&
            !proposalLapsed(pending, cutoff) &&
            pending?.startsOn != null &&
            acceptBlockedReason === null,
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

// A contract is the bookable act, so it carries the same gate as reach-out —
// including for a pair whose conversation predates safety verification, and
// for anybody whose verification has since lapsed.
export const createContractRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, contractCreateJsonError);
    const input = yield* validateContractCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['write'] })(
      authenticated
    );
    yield* requireVerifiedSafety(userAndSession);
    yield* requireLiveApproval(userAndSession);
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
    yield* requireVerifiedSafety(userAndSession);
    yield* requireLiveApproval(userAndSession);
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
    yield* requireVerifiedSafety(userAndSession);
    yield* requireLiveApproval(userAndSession);
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
    case 'StartDateRequiredError':
      return error.action === 'accept'
        ? c.json(
            {
              error: {
                code: 'START_DATE_REQUIRED' as const,
                message: 'These terms have no start date — ask for new terms with a start date.'
              }
            },
            422
          )
        : c.json(
            {
              error: {
                code: 'START_DATE_REQUIRED' as const,
                message: 'Pick a start date before sending.'
              }
            },
            422
          );
    case 'FamilyLocationRequiredError':
      return c.json(
        {
          error: {
            code: 'FAMILY_LOCATION_REQUIRED' as const,
            message:
              'Add your address to your profile before sending — session times follow your local time zone.'
          }
        },
        422
      );
    case 'StartDateNotInFutureError':
      return c.json(
        {
          error: {
            code: 'START_DATE_NOT_IN_FUTURE' as const,
            message: 'The start date must be after today.'
          }
        },
        422
      );
    case 'ContractStartDatePassedError':
      return c.json(
        {
          error: {
            code: 'CONTRACT_START_DATE_PASSED' as const,
            message: 'The start date has passed — ask the family for new terms with a later date.'
          }
        },
        409
      );
    case 'ContractProvinceRequiredError':
      return c.json(
        {
          error: {
            code: 'TAX_PROVINCE_REQUIRED' as const,
            message: error.viewerIsParty
              ? error.party === 'family'
                ? 'Add your province to your profile address — sales tax on the service fee depends on it.'
                : 'Add your province to your profile address — tax on the Poppynz commission depends on it.'
              : error.party === 'family'
                ? "The family's profile address has no province yet, so these terms can't be priced. Ask them to add it."
                : "The helper's profile address has no province yet, so these terms can't be priced. Ask them to add it.",
            party: error.party
          }
        },
        422
      );
    case 'PaymentMethodRequiredError':
      return c.json(
        {
          error: {
            code: 'PAYMENT_METHOD_REQUIRED' as const,
            message: "Add a card in Billing before sending — it's used for contract billing."
          }
        },
        422
      );
    case 'SafetyVerificationRequiredError':
      return c.json({ error: safetyVerificationRequiredResponseBody }, 403);
    case 'SafetyVerificationGateUnavailableError':
      return c.json({ error: safetyVerificationGateUnavailableResponseBody }, 503);
    case 'ApprovalRequiredError':
      return c.json(
        {
          error: approvalRequiredResponseBody(
            error.role,
            'You need a current approval to send or accept contract terms.'
          )
        },
        403
      );
    case 'ApprovalGateUnavailableError':
      return c.json({ error: approvalGateUnavailableResponseBody }, 503);
    case 'CounterpartNotApprovedError':
      return c.json(
        {
          error: {
            code: 'COUNTERPART_UNAVAILABLE' as const,
            message: "The other person can't take on new contracts right now."
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
