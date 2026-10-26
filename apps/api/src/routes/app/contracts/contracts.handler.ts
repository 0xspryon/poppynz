import type { SqlError } from '@effect/sql/SqlError';
import {
  cardOnFile,
  contractBillingPolicy,
  effectiveEnd,
  effectiveEndsOn,
  familyRetryEligible,
  firstSessionStart,
  isPaymentReady,
  loadTaxSnapshot,
  newContractBilling,
  planCycle,
  retryContractPayment,
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
  offerFloorCents,
  UserProfileRepo,
  UserRepo,
  type Contract,
  type ContractServiceItem,
  type ContractSession,
  type ContractVersion,
  type ContractWithContext,
  type DBNotFoundError
} from '@repo/db';
import { instantAt, todayIn, zoneLabel } from '@repo/calendar';
import { zoneForLocation } from '@repo/calendar/lookup';
import { contractConfig } from '@repo/env';
import { publishNotificationBestEffort } from '@repo/notify';
import type { PaymentProviderError } from '@repo/payments';
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
  type ContractTermsInput,
  contractSendJsonError,
  validateContractSendInput
} from './contracts.validator';

export class ContractRepoError extends Data.TaggedError('ContractRepoError')<{
  cause: SqlError | DBNotFoundError;
}> {}

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

/** Terms name a service the helper still lists but that families may not
 * see — a custom service awaiting (or refused) review, or a credentialed
 * service whose credential is missing, rejected or expired. Sign & send and
 * accept both refuse it rather than contracting an unapproved service. */
export class ContractServiceNotPublishableError extends Data.TaggedError(
  'ContractServiceNotPublishableError'
)<{ serviceIds: Array<string> }> {}

/** Offers floor at the service's BASE rate (UAT #39) — its catalogue rate,
 * or the platform base rate for a custom service — never at a fraction of
 * what the helper lists. Violations name the offending line items (and the
 * floor) so the editor can point at the right rows. */
export class RateBelowListedError extends Data.TaggedError('RateBelowListedError')<{
  violations: Array<{ serviceId: string; listedRateCents: number; floorRateCents: number }>;
}> {}

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

/** UAT round 2 (2026-10-26): terms can be sent and accepted until
 * `CONTRACT_MIN_LEAD_MINUTES` (default 120) before the FIRST session starts,
 * in the contract's zone. `action` picks the copy: the sender picks a later
 * start date, the receiver asks for new terms. */
export class FirstSessionTooSoonError extends Data.TaggedError('FirstSessionTooSoonError')<{
  action: 'send' | 'accept';
  minLeadMinutes: number;
}> {}

/** A helper who isn't payment-ready can accept and finish payouts later —
 * unless cycle 1's capture time (the readiness deadline) is already too close
 * to wait for it: then payouts come first, or the contract would be cancelled
 * the moment it is accepted. */
export class PayoutsRequiredToAcceptError extends Data.TaggedError(
  'PayoutsRequiredToAcceptError'
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

/** The billing cycle doesn't exist on this contract (or the contract has no
 * billing yet) — the same 404 an outsider gets for the contract. */
export class ContractCycleNotFoundError extends Data.TaggedError('ContractCycleNotFoundError')<{}> {}

/** "Retry payment" with nothing to retry: no declined hold in its grace
 * period and no card suspension (already funded, or not the card's fault). */
export class PaymentRetryNotNeededError extends Data.TaggedError('PaymentRetryNotNeededError')<{}> {}

/** "Retry payment" is limited to once a minute per contract. */
export class PaymentRetryRateLimitedError extends Data.TaggedError(
  'PaymentRetryRateLimitedError'
)<{ retryAfterSeconds: number }> {}

/** The payment provider could not be reached while retrying. Nothing was
 * lost: the attempt is retried under the same key by the billing tick. */
export class ContractPaymentProviderError extends Data.TaggedError(
  'ContractPaymentProviderError'
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

/** What decides, at read time, whether a proposal can still be accepted: the
 * expiry window's cutoff and the lead-time rule (now + minimum lead before
 * the first session). One value so every view applies the same rule. */
export type ProposalClock = { cutoff: Date; now: Date; minLeadMinutes: number };

/** Proposal expiry window (its config read collapses to the default rather
 * than surfacing ConfigError into every route program) and the minimum lead
 * before the first session (a contract billing setting: a malformed value
 * fails loudly, like the commissions). */
export const contractProposalContext = Effect.all([
  contractConfig.pipe(Effect.orElseSucceed(() => ({ proposalExpiryDays: 14 }))),
  contractBillingPolicy
]).pipe(
  Effect.map(([{ proposalExpiryDays }, policy]) => {
    const now = new Date();
    return {
      expiryDays: proposalExpiryDays,
      cutoff: new Date(now.getTime() - proposalExpiryDays * 24 * 60 * 60 * 1000),
      now,
      minLeadMinutes: policy.minLeadMinutes,
      holdLeadHours: policy.holdLeadHours
    };
  })
);

const isExpired = (version: ContractVersion | null, cutoff: Date) =>
  version !== null &&
  version.status === 'proposed' &&
  version.sentAt !== null &&
  version.sentAt < cutoff;

/** The terms as billing will plan them (the version's own zone). */
const scheduleTermsOf = (
  version: Pick<ContractVersion, 'services' | 'endsOn' | 'endsAtMinutes'>,
  startsOn: string,
  timeZone: string
) => ({
  services: version.services,
  startsOn,
  timeZone,
  endsOn: version.endsOn,
  endsAtMinutes: version.endsOn ? version.endsAtMinutes : null
});

/** When the version's first session starts — or, for terms that never
 * produce one, the start date's midnight in the zone. */
const firstSessionAt = (
  version: Pick<ContractVersion, 'services' | 'endsOn' | 'endsAtMinutes'>,
  startsOn: string,
  timeZone: string
) =>
  firstSessionStart(scheduleTermsOf(version, startsOn, timeZone)) ??
  instantAt(startsOn, 0, timeZone);

/** The lead-time rule (UAT round 2): too late once the first session starts
 * less than `minLeadMinutes` from `now`. */
const startsTooSoon = (
  version: Pick<ContractVersion, 'services' | 'endsOn' | 'endsAtMinutes'>,
  startsOn: string,
  timeZone: string,
  clock: Pick<ProposalClock, 'now' | 'minLeadMinutes'>
) =>
  firstSessionAt(version, startsOn, timeZone).getTime() - clock.now.getTime() <
  clock.minLeadMinutes * 60 * 1000;

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

/** Too late to accept by the lead-time rule: the first session starts less
 * than the minimum lead from now, in the version's zone. A sent version with
 * no start date has not passed one — accept refuses it as START_DATE_REQUIRED
 * and the detail view just withholds `canAccept` (development data only; send
 * always requires one). A sent version without a zone can't be accepted
 * either (the CHECK constraint makes that impossible for real rows). */
const leadTimePassed = (version: ContractVersion, clock: ProposalClock) => {
  if (version.startsOn === null) return false;
  if (!version.timeZone) return true;
  return startsTooSoon(version, version.startsOn, version.timeZone, clock);
};

/** A sent, undecided proposal that can no longer be accepted by the passage
 * of time: past the expiry window, or too close to its first session.
 * Either way it presents as expired (read-time only, never written back),
 * stops awaiting the receiver and stops being news for them. The single
 * source for the detail, list, chat pill and badge so they can't disagree. */
const proposalLapsed = (pending: ContractVersion | null, clock: ProposalClock) =>
  pending !== null &&
  pending.status === 'proposed' &&
  (isExpired(pending, clock.cutoff) || leadTimePassed(pending, clock));

/** The payment-readiness deadline must leave at least one billing tick
 * (15 minutes) for the helper to finish payouts and be noticed. */
const READINESS_MIN_WINDOW_MS = 15 * 60 * 1000;

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
  clock: ProposalClock
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
  if (contract.status === 'proposed' && proposalLapsed(pending, clock)) {
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
const newsAtFor = (
  row: ContractWithContext,
  viewerUserId: string,
  clock: ProposalClock
): Date | null => {
  const pending = pendingOf(row.versions);
  const lastDecided = latestDecidedOf(row.versions);
  const candidates: Array<Date> = [];
  if (
    pending?.status === 'proposed' &&
    pending.proposedByUserId !== viewerUserId &&
    pending.sentAt !== null &&
    !proposalLapsed(pending, clock)
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

const hasNewsFor = (row: ContractWithContext, viewerUserId: string, clock: ProposalClock) => {
  const newsAt = newsAtFor(row, viewerUserId, clock);
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
  /** `CONTRACT_HOLD_LEAD_HOURS`, for the family's "held … before" note. */
  holdLeadHours: number;
};

/** One week of the pattern, priced for the viewer's side only: the family
 * sees the service fee and its tax added, the helper sees the commission and
 * its tax deducted. Rounded per session by the one rule billing uses. */
export const weeklyPricing = (
  version: Pick<ContractVersion, 'services' | 'startsOn'>,
  inputs: PricingInputs
) => {
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
      totalCents: serviceCents + serviceTax.taxCents + feeCents + feeTax.taxCents,
      holdLeadHours: inputs.holdLeadHours
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
      // UAT round 2 #13: the family's "Retry payment" (declined / card-suspended).
      canRetryPayment: side === 'family' && familyRetryEligible(billing, cycles, new Date()),
      // UAT round 2 #10: how long before a cycle starts it is held.
      holdLeadHours: (yield* contractBillingPolicy).holdLeadHours,
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
  // When the family signed with "Sign & send" (null for terms sent before
  // signatures were recorded).
  familySignedAt: version.familySignedAt?.toISOString() ?? null,
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
  clock: ProposalClock
) => {
  const visible = visibleVersionsFor(row.versions, viewerUserId);
  const pending = pendingOf(row.versions);
  const accepted = acceptedOf(visible);
  const termsSource = accepted ?? pendingOf(visible) ?? visible[visible.length - 1] ?? null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    status: presentedContractStatus(row, pending, accepted, clock),
    awaitingYou:
      pending?.status === 'proposed' &&
      pending.proposedByUserId !== viewerUserId &&
      !proposalLapsed(pending, clock),
    hasNews: hasNewsFor(row, viewerUserId, clock),
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
  clock: ProposalClock
) => {
  if (!isParticipant(contract, viewerUserId) || hiddenFromViewer(contract, viewerUserId))
    return null;
  const visible = visibleVersionsFor(versions, viewerUserId);
  const pending = pendingOf(versions);
  const accepted = acceptedOf(visible);
  const termsSource = accepted ?? pendingOf(visible) ?? visible[visible.length - 1] ?? null;
  return {
    id: contract.id,
    status: presentedContractStatus(contract, pending, accepted, clock),
    awaitingYou:
      pending?.status === 'proposed' &&
      pending.proposedByUserId !== viewerUserId &&
      !proposalLapsed(pending, clock),
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
    // Only services families may see can be contracted — a custom service
    // awaiting review, or a PSW service without an approved credential, is
    // as good as unlisted.
    const listed = yield* ServiceOfferedRepo.pipe(
      Effect.flatMap((repo) => repo.listPublishableByUserIds([providerUserId])),
      (errors) => mapContractRepoError(errors)
    );
    const listedById = new Map(listed.map((service) => [service.id, service]));
    const seen = new Set<string>();
    const services: Array<ContractServiceItem> = [];
    const violations: Array<{
      serviceId: string;
      listedRateCents: number;
      floorRateCents: number;
    }> = [];
    for (const item of input.services) {
      const service = listedById.get(item.serviceId);
      if (!service || seen.has(item.serviceId)) {
        return yield* Effect.fail(new UnknownContractServiceError());
      }
      seen.add(item.serviceId);
      const floorRateCents = offerFloorCents(service);
      if (item.rateCents < floorRateCents) {
        violations.push({
          serviceId: service.id,
          listedRateCents: service.hourlyRateCents,
          floorRateCents
        });
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

/**
 * Every snapshotted service that the helper still lists must be publishable.
 * A service the helper has since removed keeps its snapshot (the family
 * agreed to the terms as drafted); one that is still listed but not
 * publishable fails with the offending ids. Returns the publishable listing.
 */
const ensureSnapshotServicesPublishable = (
  providerUserId: string,
  items: ReadonlyArray<{ serviceId: string }>
) =>
  Effect.gen(function* () {
    const repo = yield* ServiceOfferedRepo;
    const [listed, active] = yield* Effect.all([
      repo.listPublishableByUserIds([providerUserId]),
      repo.listByUserId(providerUserId)
    ]).pipe((errors) => mapContractRepoError(errors));
    const publishableIds = new Set(listed.map((service) => service.id));
    const activeIds = new Set(active.map((service) => service.id));
    const blocked = items
      .map((item) => item.serviceId)
      .filter((id) => activeIds.has(id) && !publishableIds.has(id));
    if (blocked.length > 0) {
      return yield* Effect.fail(
        new ContractServiceNotPublishableError({ serviceIds: Array.from(new Set(blocked)) })
      );
    }
    return listed;
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
    // not slipped through. Rates on removed services keep their snapshot, as
    // do items whose listing switched currency (cents in different currencies
    // are not comparable). A service still listed but no longer publishable
    // (review pending or refused, credential lost) stops the send.
    const listed = yield* ensureSnapshotServicesPublishable(
      contract.providerUserId,
      pending.services
    );
    const listedById = new Map(listed.map((service) => [service.id, service]));
    const violations: Array<{
      serviceId: string;
      listedRateCents: number;
      floorRateCents: number;
    }> = [];
    const refreshed = pending.services.map((item) => {
      const current = listedById.get(item.serviceId);
      if (!current || current.currency !== item.currency) return item;
      const floorRateCents = offerFloorCents(current);
      if (item.rateCents < floorRateCents) {
        violations.push({
          serviceId: item.serviceId,
          listedRateCents: current.hourlyRateCents,
          floorRateCents
        });
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
    // UAT round 2: up to CONTRACT_MIN_LEAD_MINUTES before the first session.
    const clock = yield* contractProposalContext;
    if (startsTooSoon(pending, pending.startsOn, timeZone, clock)) {
      return yield* Effect.fail(
        new FirstSessionTooSoonError({ action: 'send', minLeadMinutes: clock.minLeadMinutes })
      );
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
    const clock = yield* contractProposalContext;
    if (isExpired(pending, clock.cutoff)) {
      return yield* Effect.fail(new ContractProposalExpiredError());
    }
    if (pending.startsOn === null) {
      return yield* Effect.fail(new StartDateRequiredError({ action: 'accept' }));
    }
    if (leadTimePassed(pending, clock)) {
      return yield* Effect.fail(
        new FirstSessionTooSoonError({ action: 'accept', minLeadMinutes: clock.minLeadMinutes })
      );
    }
    yield* requireContractCounterpart(pending.proposedByUserId);
    // Re-checked at acceptance: a service can lose its approval (or its
    // credential) while the proposal waits.
    yield* ensureSnapshotServicesPublishable(contract.providerUserId, pending.services);

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
    // Accepting rarely waits on payouts: a helper who isn't ready yet puts
    // the contract in the payment-readiness gate, whose deadline is cycle 1's
    // capture time. A booking this late (UAT round 2: up to the minimum lead
    // before the first session) can leave that deadline already passed or
    // too close for the 15-minute tick to notice the helper got ready — the
    // gate would cancel the contract on acceptance, so payouts come first.
    const helperReady = yield* isPaymentReady(contract.providerUserId);
    if (!helperReady) {
      const cycleOne = planCycle(
        {
          ...scheduleTermsOf(pending, pending.startsOn, pending.timeZone),
          holdLeadHours: clock.holdLeadHours
        },
        0
      );
      if (
        cycleOne !== null &&
        cycleOne.captureAt.getTime() - acceptedAt.getTime() < READINESS_MIN_WINDOW_MS
      ) {
        return yield* Effect.fail(new PayoutsRequiredToAcceptError());
      }
    }
    const billing = yield* newContractBilling({
      timeZone: pending.timeZone,
      startsOn: pending.startsOn,
      familyProvince,
      helperProvince,
      helperReady,
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
    const clock = yield* contractProposalContext;
    const rows = yield* contractRepo
      .listForUser(viewer.id)
      .pipe((errors) => mapContractRepoError(errors));
    const visible = rows.filter((row) => !hiddenFromViewer(row, viewer.id));
    // B5: a suspended contract must read "Suspended" in the list too, not
    // "Active" — so active rows carry their billing state.
    const billingRepo = yield* ContractBillingRepo;
    const billingById = new Map(
      yield* Effect.forEach(
        visible.filter((row) => row.status === 'active' || row.status === 'ending'),
        (row) =>
          billingRepo.findBilling(row.id).pipe(
            (errors) => mapContractRepoError(errors),
            Effect.map((billing) => [row.id, billing] as const)
          ),
        { concurrency: 5 }
      )
    );
    return {
      contracts: visible.map((row) => {
        const billing = billingById.get(row.id) ?? null;
        return {
          ...toContractListItem(row, viewer.id, clock),
          billingStatus: billing?.status ?? null,
          billingSuspendedReason: billing?.suspendedReason ?? null
        };
      })
    };
  });

export const contractsBadgeCountProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;
    const clock = yield* contractProposalContext;
    const rows = yield* contractRepo
      .listForUser(viewer.id)
      .pipe((errors) => mapContractRepoError(errors));
    const total = rows.filter(
      (row) => !hiddenFromViewer(row, viewer.id) && hasNewsFor(row, viewer.id, clock)
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

    const clock = yield* contractProposalContext;
    const { expiryDays } = clock;
    const viewerSide = sideOf(row, viewer.id);
    const pending = pendingOf(row.versions);
    const accepted = acceptedOf(row.versions);
    const presented = presentedContractStatus(row, pending, accepted, clock);

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
      today: timeZone ? todayIn(timeZone) : null,
      holdLeadHours: clock.holdLeadHours
    };
    const pricingOf = (version: ContractVersion) => weeklyPricing(version, pricingInputs);
    const effective = effectiveEnd(row, accepted);
    // Why the proposal can't be accepted, for both sides: the receiver's
    // Accept is gone, and the proposer is told to send a later start date.
    const acceptBlockedReason =
      row.status === 'proposed' && pending?.status === 'proposed' && leadTimePassed(pending, clock)
        ? ('starts_too_soon' as const)
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
        // Today counts (UAT round 2): send checks the first session's lead.
        earliestStartsOn: timeZone ? todayIn(timeZone) : null,
        minLeadMinutes: clock.minLeadMinutes,
        holdLeadHours: clock.holdLeadHours,
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
            !proposalLapsed(pending, clock) &&
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

/** Contract statuses that are still being negotiated — at most one per
 * conversation (the `contracts_conversation_negotiating_uidx` index). */
const negotiatingStatuses: ReadonlyArray<Contract['status']> = [
  'draft',
  'proposed',
  'changes_requested',
  'declined'
];

/**
 * UAT round 2 #7b: "Start a new contract from this one". Signed contracts
 * are never amended; the family starts a new DRAFT contract (same family,
 * helper and conversation) pre-filled with the old contract's services,
 * rates, expectations and weekly sessions — dates blank. Everything send
 * checks (base-rate floor, publishable services, card on file, lead time)
 * still applies when the new draft is sent. Services the helper no longer
 * offers to families are left out (the draft could not be saved with them)
 * and named in `droppedServiceIds`.
 */
export const renewContractProgram = (userAndSession: UserAndSession, contractId: string) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const conversationRepo = yield* ConversationRepo;
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);
    if (sideOf(contract, viewer.id) !== 'family') {
      return yield* Effect.fail(new NotContractActorError());
    }
    const { versions, pending } = yield* loadPendingVersion(contractId);
    const accepted = acceptedOf(versions);
    const clock = yield* contractProposalContext;
    const presented = presentedContractStatus(contract, pending, accepted, clock);
    if (
      accepted === null ||
      (presented !== 'active' && presented !== 'ending' && presented !== 'ended')
    ) {
      return yield* Effect.fail(new ContractStateError());
    }
    const conversation = yield* conversationRepo
      .findById(contract.conversationId)
      .pipe((errors) => mapContractRepoError(errors));
    if (!conversation || conversation.status !== 'active') {
      return yield* Effect.fail(new ContractConversationNotActiveError());
    }

    // One negotiation per conversation: an open one is where to go instead.
    const negotiatingIn = (rows: ReadonlyArray<Contract>) =>
      rows.find((row) => negotiatingStatuses.includes(row.status)) ?? null;
    const siblings = yield* contractRepo
      .listByConversationId(contract.conversationId)
      .pipe((errors) => mapContractRepoError(errors));
    const open = negotiatingIn(siblings);
    if (open) {
      return yield* Effect.fail(new ContractExistsError({ contractId: open.id }));
    }

    const listed = yield* ServiceOfferedRepo.pipe(
      Effect.flatMap((repo) => repo.listPublishableByUserIds([contract.providerUserId])),
      (errors) => mapContractRepoError(errors)
    );
    const listedById = new Map(listed.map((service) => [service.id, service]));
    const services = accepted.services.flatMap((item): Array<ContractServiceItem> => {
      const current = listedById.get(item.serviceId);
      if (!current) return [];
      return [
        {
          ...item,
          name: current.name,
          listedRateCents: current.hourlyRateCents,
          currency: current.currency,
          sessions: item.sessions.map((session) => ({ ...session }))
        }
      ];
    });
    const droppedServiceIds = accepted.services
      .map((item) => item.serviceId)
      .filter((id) => !listedById.has(id));

    const created = yield* contractRepo
      .create({
        conversationId: contract.conversationId,
        familyUserId: contract.familyUserId,
        providerUserId: contract.providerUserId,
        services
      })
      .pipe(
        // Two clicks (or tabs) race the negotiating-unique index: the loser
        // is pointed at the winner, as the check above would have done.
        Effect.catchTag('SqlError', (cause) =>
          isUniqueViolation(cause)
            ? contractRepo.listByConversationId(contract.conversationId).pipe(
                (errors) => mapContractRepoError(errors),
                Effect.flatMap((rows) => {
                  const winner = negotiatingIn(rows);
                  return Effect.fail(
                    winner
                      ? new ContractExistsError({ contractId: winner.id })
                      : new ContractRepoError({ cause })
                  );
                })
              )
            : Effect.fail(new ContractRepoError({ cause }))
        )
      );
    // No notification: a draft is family-private until it is sent.
    return { id: created.contract.id, droppedServiceIds };
  });

/** Billing failures reachable from the retry path, as route errors: the
 * database or a missing row is a lookup failure, the provider its own 503. */
function mapRetryError<A, R>(
  effect: Effect.Effect<A, SqlError | DBNotFoundError | PaymentProviderError, R>
): Effect.Effect<A, ContractRepoError | ContractPaymentProviderError, R> {
  return effect.pipe(
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new ContractRepoError({ cause })),
      DBNotFoundError: (cause) => Effect.fail(new ContractRepoError({ cause })),
      PaymentProviderError: () => Effect.fail(new ContractPaymentProviderError())
    })
  );
}

/** "Retry payment" may run once a minute per contract. */
export const PAYMENT_RETRY_INTERVAL_MS = 60 * 1000;

/**
 * UAT round 2 #13: the family's "Retry payment" on a declined or
 * card-suspended contract. Runs the card-replaced retry path for this
 * contract only (`retryContractPayment`: same idempotency keys and lookup
 * guards as the worker), at most once a minute per contract — claimed by a
 * compare-and-set, so a double click or two tabs start one retry.
 */
export const retryContractPaymentProgram = (userAndSession: UserAndSession, contractId: string) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);
    // Only the family pays: the helper has no card to retry.
    if (sideOf(contract, viewer.id) !== 'family') {
      return yield* Effect.fail(new NotContractActorError());
    }
    const repo = yield* ContractBillingRepo;
    const now = new Date();
    const billing = yield* repo
      .findBilling(contractId)
      .pipe((errors) => mapContractRepoError(errors));
    const cycles = yield* repo
      .listCycles(contractId)
      .pipe((errors) => mapContractRepoError(errors));
    if (!familyRetryEligible(billing, cycles, now)) {
      return yield* Effect.fail(new PaymentRetryNotNeededError());
    }
    const claimed = yield* repo
      .claimFamilyRetry(contractId, now, new Date(now.getTime() - PAYMENT_RETRY_INTERVAL_MS))
      .pipe((errors) => mapContractRepoError(errors));
    if (claimed === null) {
      const last = billing?.familyRetryAt?.getTime() ?? now.getTime();
      return yield* Effect.fail(
        new PaymentRetryRateLimitedError({
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((last + PAYMENT_RETRY_INTERVAL_MS - now.getTime()) / 1000)
          )
        })
      );
    }
    const outcome = yield* retryContractPayment(viewer.id, contractId, now).pipe((errors) =>
      mapRetryError(errors)
    );
    return { outcome };
  });

const supplyLines = (
  lines: ReadonlyArray<{ supplyType: string; label: string; taxCents: number }>,
  supplyType: string
) => taxLineViews(lines.filter((line) => line.supplyType === supplyType));

/**
 * UAT round 2 #11a: one billing cycle, read-only for now — its dates and
 * status, the hold / charge (and, for the helper, transfer) instants, the
 * viewer's own amounts (family: care + fee + tax; helper: share after the
 * commission and its tax), and the timetable of its dated sessions in the
 * contract zone. Only the contract's family and helper may read it (the
 * same 404 as the contract for anybody else). Tier 3 hangs session actions
 * (cancellation, dispute, extra sessions) off `sessions[].id`.
 */
export const getContractCycleProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  cycleId: string
) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);
    const side = sideOf(contract, viewer.id);
    const repo = yield* ContractBillingRepo;
    const billing = yield* repo
      .findBilling(contractId)
      .pipe((errors) => mapContractRepoError(errors));
    if (billing === null) return yield* Effect.fail(new ContractCycleNotFoundError());
    const cycles = yield* repo
      .listCycles(contractId)
      .pipe((errors) => mapContractRepoError(errors));
    const cycle = cycles.find((row) => row.id === cycleId);
    if (!cycle) return yield* Effect.fail(new ContractCycleNotFoundError());
    const sessions = yield* repo
      .listSessions(contractId, cycle.id)
      .pipe((errors) => mapContractRepoError(errors));
    const { versions } = yield* loadPendingVersion(contractId);
    const accepted = versions.find((version) => version.id === billing.acceptedVersionId) ?? null;
    const serviceNames = new Map(
      (accepted?.services ?? []).map((service) => [service.serviceId, service.name])
    );
    const now = new Date();
    const counterpartUserId = side === 'family' ? contract.providerUserId : contract.familyUserId;
    const counterpartProfile = yield* loadProfileOrNull(counterpartUserId);

    const quoted = cycle.serviceCents !== null;
    const amounts = !quoted
      ? null
      : side === 'family'
        ? {
            side: 'family' as const,
            serviceCents: cycle.serviceCents ?? 0,
            serviceTaxLines: supplyLines(cycle.taxLines, 'care_service_value'),
            feeBps: cycle.familyFeeBps ?? billing.familyFeeBps,
            feeCents: cycle.familyFeeCents ?? 0,
            feeTaxLines: supplyLines(cycle.taxLines, 'family_service_fee'),
            totalCents: cycle.familyTotalCents ?? 0,
            // A reduced capture charged less than the quote.
            chargedCents: cycle.capturedCents
          }
        : {
            side: 'provider' as const,
            serviceCents: cycle.serviceCents ?? 0,
            serviceTaxLines: supplyLines(cycle.taxLines, 'care_service_value'),
            commissionBps: cycle.providerCommissionBps ?? billing.providerCommissionBps,
            commissionCents: cycle.providerCommissionCents ?? 0,
            commissionTaxLines: supplyLines(cycle.taxLines, 'provider_commission'),
            shareCents: cycle.providerShareCents ?? 0
          };

    return {
      cycle: {
        id: cycle.id,
        contractId,
        index: cycle.index,
        startsOn: cycle.startsOn,
        endsOn: cycle.endsOn,
        status: cycle.status,
        startsAt: cycle.startsAt.toISOString(),
        endsAt: cycle.endsAt.toISOString(),
        holdAt: cycle.holdAt.toISOString(),
        captureAt: cycle.captureAt.toISOString(),
        // Transfers are the helper's business (piece 4).
        transferAt: side === 'provider' ? cycle.transferAt.toISOString() : null,
        timeZone: billing.timeZone,
        timeZoneLabel: zoneLabel(billing.timeZone),
        viewerSide: side,
        counterpartName: displayName(counterpartProfile, 'Poppynz member'),
        billingStatus: billing.status,
        suspendedReason: billing.suspendedReason,
        amounts,
        // Before the quote: what the scheduled sessions are worth so far.
        estimatedServiceCents: sessions
          .filter((session) => session.status === 'scheduled' || session.status === 'completed')
          .reduce((total, session) => total + session.valueCents, 0),
        carriedInCents: cycle.carriedInCents,
        sessions: sessions.map((session) => ({
          id: session.id,
          date: session.date,
          serviceId: session.serviceId,
          serviceName: serviceNames.get(session.serviceId) ?? null,
          startMinutes: session.startMinutes,
          endMinutes: session.endMinutes,
          elapsedMinutes: session.elapsedMinutes,
          status: session.status,
          startsAt: session.startsAt.toISOString(),
          endsAt: session.endsAt.toISOString()
        })),
        canRetryPayment: side === 'family' && familyRetryEligible(billing, cycles, now)
      }
    };
  });

/** UAT round 2 #5: the viewer's running contracts (active or under notice —
 * billing suspended or awaiting payment readiness included), so the landing
 * after sign-in and the role home can open the contract view. */
export const contractLandingProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const contractRepo = yield* ContractRepo;
    const viewer = userAndSession.user;
    const clock = yield* contractProposalContext;
    const rows = yield* contractRepo
      .listForUser(viewer.id)
      .pipe((errors) => mapContractRepoError(errors));
    const running = rows.filter((row) => {
      if (hiddenFromViewer(row, viewer.id)) return false;
      const status = presentedContractStatus(
        row,
        pendingOf(row.versions),
        acceptedOf(row.versions),
        clock
      );
      return status === 'active' || status === 'ending';
    });
    return { activeContractIds: running.map((row) => row.id) };
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

/**
 * B6: the draft editor's price box, live. Prices the family's UNSAVED terms
 * exactly as a saved draft would be priced (same validation, floor and tax),
 * without writing anything.
 */
export const quoteTermsProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  input: ContractTermsInput
) =>
  Effect.gen(function* () {
    const viewer = userAndSession.user;
    const contract = yield* loadParticipantContract(contractId, viewer.id);
    if (sideOf(contract, viewer.id) !== 'family') {
      return yield* Effect.fail(new NotContractActorError());
    }
    const services = yield* snapshotTerms(contract.providerUserId, input);
    const policy = yield* contractBillingPolicy;
    const snapshot = yield* loadTaxSnapshot.pipe((errors) => mapContractRepoError(errors));
    const timeZone = yield* familyTimeZone(contract.familyUserId);
    const pricing = weeklyPricing(
      { services, startsOn: input.startsOn ?? null },
      {
        snapshot,
        familyFeeBps: policy.familyCommissionBps,
        providerCommissionBps: policy.providerCommissionBps,
        familyProvince: yield* profileProvince(contract.familyUserId),
        helperProvince: yield* profileProvince(contract.providerUserId),
        side: 'family',
        today: timeZone ? todayIn(timeZone) : null,
        holdLeadHours: policy.holdLeadHours
      }
    );
    return { pricing, weeklyEstimateCents: weeklyEstimateCents(services) };
  });

export const quoteTermsRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const rawBody = yield* parseJsonBody(c, contractTermsJsonError);
    const input = yield* validateContractTermsInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['read'] })(
      authenticated
    );
    return yield* quoteTermsProgram(userAndSession, contractId, input);
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
    yield* validateContractSendInput(yield* parseJsonBody(c, contractSendJsonError));
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

export const renewContractRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['write'] })(
      authenticated
    );
    // Starting a contract is the bookable act: the same gates as creating one.
    yield* requireVerifiedSafety(userAndSession);
    yield* requireLiveApproval(userAndSession);
    return yield* renewContractProgram(userAndSession, contractId);
  });

export const retryContractPaymentRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    // The card on file is the family's billing; the contract is the subject.
    const userAndSession = yield* requirePermissions(headers, {
      contract: ['write'],
      billing: ['write']
    })(authenticated);
    return yield* retryContractPaymentProgram(userAndSession, contractId);
  });

export const getContractCycleRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const cycleId = yield* validateContractId(c.req.param('cycleId'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['read'] })(
      authenticated
    );
    return yield* getContractCycleProgram(userAndSession, contractId, cycleId);
  });

export const contractLandingRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { contract: ['read'] })(
      authenticated
    );
    return yield* contractLandingProgram(userAndSession);
  });

export type ContractRouteError =
  | Effect.Effect.Error<ReturnType<typeof createContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listContractsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof quoteTermsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof contractsBadgeCountRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof saveTermsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof sendContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof withdrawContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof acceptContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof declineContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof requestChangesRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof endContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof markContractSeenRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof renewContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof retryContractPaymentRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getContractCycleRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof contractLandingRouteProgram>>;

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
    case 'ContractServiceNotPublishableError':
      return c.json(
        {
          error: {
            code: 'CONTRACT_SERVICE_NOT_AVAILABLE' as const,
            message:
              "Some services in these terms aren't approved for families yet — remove them and send again.",
            serviceIds: error.serviceIds
          }
        },
        422
      );
    case 'RateBelowListedError':
      return c.json(
        {
          error: {
            code: 'RATE_BELOW_LISTED' as const,
            message:
              "Offers start at the service's base rate — the lowest rate helpers can charge for it.",
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
    case 'FirstSessionTooSoonError':
      return error.action === 'send'
        ? c.json(
            {
              error: {
                code: 'FIRST_SESSION_TOO_SOON' as const,
                message: `The first session must start at least ${error.minLeadMinutes} minutes from now — pick a later start date.`,
                minLeadMinutes: error.minLeadMinutes
              }
            },
            422
          )
        : c.json(
            {
              error: {
                code: 'FIRST_SESSION_TOO_SOON' as const,
                message: `The first session starts in less than ${error.minLeadMinutes} minutes — ask the family for new terms with a later date.`,
                minLeadMinutes: error.minLeadMinutes
              }
            },
            409
          );
    case 'PayoutsRequiredToAcceptError':
      return c.json(
        {
          error: {
            code: 'PAYOUTS_REQUIRED_TO_ACCEPT' as const,
            message:
              'This contract starts too soon to wait for your payout account — set up payouts, then accept.'
          }
        },
        422
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
    case 'ContractCycleNotFoundError':
      return c.json(
        {
          error: {
            code: 'CONTRACT_CYCLE_NOT_FOUND' as const,
            message: 'Billing cycle not found.'
          }
        },
        404
      );
    case 'PaymentRetryNotNeededError':
      return c.json(
        {
          error: {
            code: 'PAYMENT_RETRY_NOT_NEEDED' as const,
            message: 'There is no declined payment to retry on this contract.'
          }
        },
        409
      );
    case 'PaymentRetryRateLimitedError':
      c.header('Retry-After', String(error.retryAfterSeconds));
      return c.json(
        {
          error: {
            code: 'PAYMENT_RETRY_RATE_LIMITED' as const,
            message: 'A retry was just tried — wait a minute before trying again.',
            retryAfterSeconds: error.retryAfterSeconds
          }
        },
        429
      );
    case 'ContractPaymentProviderError':
      return c.json(
        {
          error: {
            code: 'PAYMENTS_UNAVAILABLE' as const,
            message: 'Payments are temporarily unavailable — we will keep trying.'
          }
        },
        503
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

export async function quoteTermsHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(quoteTermsRouteProgram(c, c.req.raw.headers));
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

export async function renewContractHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(renewContractRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function retryContractPaymentHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(
    retryContractPaymentRouteProgram(c, c.req.raw.headers)
  );
  return exitToResponse(c, exit);
}

export async function getContractCycleHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(getContractCycleRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function contractLandingHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(contractLandingRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}
