import type { SqlError } from '@effect/sql/SqlError';
import { credibledCheckTypeClub, credibledCheckTypeLabel, Credibled } from '@repo/credibled';
import {
  DBNotFoundError,
  KycDocumentTypeRepo,
  SafetyVerificationRepo,
  type KycDocumentType,
  type SafetyVerification,
  type SafetyVerificationItem,
  type SafetyVerificationRole
} from '@repo/db';
import { safetyVerificationConfig } from '@repo/env';
import { Payments, type QuoteLineItem } from '@repo/payments';
import { SafetyVerificationQueue } from '@repo/queue';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  isAuthError,
  requirePermissions,
  type UserAndSession
} from '@/api/lib/effect-auth';
import {
  credibledAudienceForRole,
  expiryFromCompletion,
  toAdminSummary,
  toApplicantSummary,
  toDateOnly
} from '@/api/lib/safety-verification';
import {
  isRequestValidationError,
  parseJsonBody,
  requestValidationErrorToResponse
} from '@/api/lib/schema-validator';
import {
  safetyVerificationDecisionJsonError,
  safetyVerificationJsonError,
  validateSafetyVerificationDecisionInput,
  validateSafetyVerificationDocumentInput,
  validateSafetyVerificationItemInput,
  validateSafetyVerificationOrderInput
} from './safety-verification.validator';

class SafetyVerificationValidationError extends Data.TaggedError(
  'SafetyVerificationValidationError'
)<{ message: string }> {}
class SafetyVerificationConflictError extends Data.TaggedError('SafetyVerificationConflictError')<{
  message: string;
}> {}
class SafetyVerificationNotFoundError extends Data.TaggedError(
  'SafetyVerificationNotFoundError'
)<{}> {}
class SafetyVerificationRoleError extends Data.TaggedError('SafetyVerificationRoleError')<{}> {}
class SafetyVerificationRepoError extends Data.TaggedError('SafetyVerificationRepoError')<{
  cause: SqlError;
}> {}
class SafetyVerificationPaymentError extends Data.TaggedError('SafetyVerificationPaymentError')<{
  reason: string;
}> {}
class SafetyVerificationVendorError extends Data.TaggedError('SafetyVerificationVendorError')<{
  reason: string;
}> {}
class SafetyVerificationQueueingError extends Data.TaggedError('SafetyVerificationQueueingError')<{
  cause: unknown;
}> {}

function mapRepoError<A, R>(
  effect: Effect.Effect<A, SqlError, R>
): Effect.Effect<A, SafetyVerificationRepoError, R>;
function mapRepoError<A, R>(
  effect: Effect.Effect<A, SqlError | DBNotFoundError, R>
): Effect.Effect<A, SafetyVerificationRepoError | SafetyVerificationNotFoundError, R>;
function mapRepoError<A, R>(effect: Effect.Effect<A, SqlError | DBNotFoundError, R>) {
  return effect.pipe(
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new SafetyVerificationRepoError({ cause })),
      DBNotFoundError: () => Effect.fail(new SafetyVerificationNotFoundError())
    })
  );
}

/** Admins are not screened — they have no applicant record and never will. */
const applicantRole = (
  userAndSession: UserAndSession
): Effect.Effect<SafetyVerificationRole, SafetyVerificationRoleError> =>
  userAndSession.user.role === 'family' || userAndSession.user.role === 'service-provider'
    ? Effect.succeed(userAndSession.user.role)
    : Effect.fail(new SafetyVerificationRoleError());

/** Mirrors the KYC upload rule: a client may only claim a file it uploaded
 * under its own prefix, otherwise it could attach somebody else's document. */
const ensureOwnFileKey = (userId: string, fileKey: string) =>
  fileKey.startsWith(`users/${userId}/`)
    ? Effect.void
    : Effect.fail(
        new SafetyVerificationValidationError({
          message: 'File key does not belong to the authenticated user.'
        })
      );

const today = () => toDateOnly(new Date());

/** Policy read collapses to the documented defaults rather than surfacing
 * ConfigError into every route program — same treatment as the contract and
 * reach-out windows. */
const policyConfig = safetyVerificationConfig.pipe(
  Effect.orElseSucceed(() => ({
    validityMonths: 12,
    expiryReminderDays: 30,
    consentPolicyVersion: '2026-08-22',
    checkCostCents: 5500,
    adminFeeCents: 500,
    taxRateBasisPoints: 0,
    orderMaxAttempts: 3
  }))
);

// ---------------------------------------------------------------------------
// Applicant-facing
// ---------------------------------------------------------------------------

/** A document type that can actually be ordered: mapped to a Credibled check
 * AND priced. Either half missing is a configuration error, not a free check. */
const isOrderable = (type: KycDocumentType, role: SafetyVerificationRole) =>
  type.appliesToRole === role &&
  type.credibledCheckTypeValue !== null &&
  type.credibledCostCents !== null;

const toLineItems = (
  items: Array<SafetyVerificationItem>,
  types: Array<KycDocumentType>
): Array<QuoteLineItem> =>
  items.map((item) => ({
    label: types.find((type) => type.id === item.documentTypeId)?.name ?? 'Check',
    // The FROZEN cost from the item, never the type's current price — an admin
    // editing pricing mid-basket must not change what was quoted.
    costCents: item.costCents
  }));

/** The basket only exists while a verification has not been paid for. */
const basketFor = (record: SafetyVerification | null) =>
  record !== null && record.status === 'not_started' ? record : null;

export const getMySafetyVerificationRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      safetyVerification: ['read']
    })(authenticated);
    const role = yield* applicantRole(userAndSession);

    const repo = yield* SafetyVerificationRepo;
    const payments = yield* Payments;
    const credibled = yield* Credibled;
    const typeRepo = yield* KycDocumentTypeRepo;

    const [record, types] = yield* Effect.all(
      [
        mapRepoError(repo.findLive(userAndSession.user.id, role)),
        mapRepoError(typeRepo.listActive())
      ],
      { concurrency: 'unbounded' }
    );

    const items = record ? yield* mapRepoError(repo.listItems(record.id)) : [];
    const quote = yield* payments.quote(toLineItems(items, types));

    // Which Credibled checks this role's document types map onto. Empty means
    // ordering is unavailable and only the upload route is offered.
    const orderableCheckTypes = types.filter((type) => isOrderable(type, role)).map((type) => ({
      documentTypeId: type.id,
      name: type.name,
      credibledCheckTypeValue: type.credibledCheckTypeValue as string,
      credibledLabel: credibledCheckTypeLabel(type.credibledCheckTypeValue as string),
      costCents: type.credibledCostCents as number,
      selected: items.some((item) => item.documentTypeId === type.id)
    }));

    return {
      verification: toApplicantSummary(record, today()),
      basket: items.map((item) => ({
        id: item.id,
        documentTypeId: item.documentTypeId,
        name: types.find((type) => type.id === item.documentTypeId)?.name ?? 'Check',
        credibledLabel: credibledCheckTypeLabel(item.credibledCheckTypeValue),
        costCents: item.costCents
      })),
      quote,
      orderableCheckTypes,
      // Credibled has no vulnerable-sector product, so the upload route is the
      // only way to evidence one. The UI leans on this rather than hard-coding
      // the same fact in two places.
      canOrderThroughCredibled:
        orderableCheckTypes.length > 0 && credibled.isConfigured(credibledAudienceForRole(role))
    };
  });

// ---------------------------------------------------------------------------
// Basket
// ---------------------------------------------------------------------------

export const addSafetyVerificationItemRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers
) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, safetyVerificationJsonError);
    const input = yield* validateSafetyVerificationItemInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      safetyVerification: ['write']
    })(authenticated);
    const role = yield* applicantRole(userAndSession);
    const userId = userAndSession.user.id;

    const repo = yield* SafetyVerificationRepo;
    const typeRepo = yield* KycDocumentTypeRepo;
    const policy = yield* policyConfig;

    const types = yield* mapRepoError(typeRepo.listActive());
    const documentType = types.find((type) => type.id === input.documentTypeId);
    if (!documentType || !isOrderable(documentType, role)) {
      return yield* Effect.fail(
        new SafetyVerificationValidationError({
          message: 'That document cannot be collected through Credibled.'
        })
      );
    }

    const existing = yield* mapRepoError(repo.findLive(userId, role));
    if (existing !== null && existing.status !== 'not_started') {
      return yield* Effect.fail(
        new SafetyVerificationConflictError({
          message: 'A safety verification is already in progress for this account.'
        })
      );
    }

    // The basket IS a `not_started` verification, created on first add.
    const record =
      existing ??
      (yield* mapRepoError(
        repo.create({
          userId,
          role,
          status: 'not_started',
          route: 'credibled',
          consentPolicyVersion: policy.consentPolicyVersion
        })
      ));

    const items = yield* mapRepoError(repo.listItems(record.id));
    const value = documentType.credibledCheckTypeValue as string;

    if (items.some((item) => item.credibledCheckTypeValue === value)) {
      return yield* Effect.fail(
        new SafetyVerificationConflictError({ message: 'That check is already in your list.' })
      );
    }

    // Credibled fulfils only the highest tier when two members of one club are
    // requested together — adding both would bill twice and deliver once.
    const club = credibledCheckTypeClub(value);
    const clash =
      club === null
        ? undefined
        : items.find((item) => credibledCheckTypeClub(item.credibledCheckTypeValue) === club);
    if (clash) {
      const clashName =
        types.find((type) => type.id === clash.documentTypeId)?.name ?? 'another check';
      return yield* Effect.fail(
        new SafetyVerificationConflictError({
          message: `${clashName} already covers this — adding both would charge you twice for one result.`
        })
      );
    }

    yield* mapRepoError(
      repo.addItem({
        verificationId: record.id,
        documentTypeId: documentType.id,
        credibledCheckTypeValue: value,
        // Frozen at add time.
        costCents: documentType.credibledCostCents as number
      })
    );

    return { added: { documentTypeId: documentType.id, name: documentType.name } };
  });

export const removeSafetyVerificationItemRouteProgram = (headers: Headers, itemId: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      safetyVerification: ['write']
    })(authenticated);
    const role = yield* applicantRole(userAndSession);

    const repo = yield* SafetyVerificationRepo;
    const record = basketFor(yield* mapRepoError(repo.findLive(userAndSession.user.id, role)));
    if (!record) {
      return yield* Effect.fail(
        new SafetyVerificationConflictError({
          message: 'Your check list can no longer be changed.'
        })
      );
    }

    // Scoped to the caller's own verification, so an id from somebody else's
    // basket resolves to not-found rather than deleting their item.
    yield* mapRepoError(repo.removeItem(record.id, itemId));
    return { removed: itemId };
  });

/** Statuses from which a fresh order or upload may be started. */
const canStartNewVerification = (record: SafetyVerification | null) =>
  record === null || record.status === 'not_started';

export const orderSafetyCheckRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, safetyVerificationJsonError);
    yield* validateSafetyVerificationOrderInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      safetyVerification: ['write']
    })(authenticated);
    const role = yield* applicantRole(userAndSession);
    const userId = userAndSession.user.id;

    const repo = yield* SafetyVerificationRepo;
    const payments = yield* Payments;
    const credibled = yield* Credibled;
    const typeRepo = yield* KycDocumentTypeRepo;
    const queue = yield* SafetyVerificationQueue;
    const policy = yield* policyConfig;

    const audience = credibledAudienceForRole(role);
    if (!credibled.isConfigured(audience)) {
      return yield* Effect.fail(
        new SafetyVerificationVendorError({
          reason: 'Ordering is not available for this account yet.'
        })
      );
    }

    const types = yield* mapRepoError(typeRepo.listActive());
    const existing = yield* mapRepoError(repo.findLive(userId, role));

    // Ordering settles an existing basket — there is nothing to charge for
    // until the applicant has chosen at least one check. An unpaid
    // `payment_pending` row from an abandoned attempt is resumable too, which
    // keeps the payment idempotency key stable across retries.
    const resumable =
      existing !== null &&
      existing.status === 'payment_pending' &&
      existing.paymentReference === null;

    if (existing === null) {
      return yield* Effect.fail(
        new SafetyVerificationValidationError({
          message: 'Choose at least one check before starting.'
        })
      );
    }
    if (existing.status !== 'not_started' && !resumable) {
      return yield* Effect.fail(
        new SafetyVerificationConflictError({
          message: 'A safety verification is already in progress for this account.'
        })
      );
    }

    const now = new Date();
    const record = existing;
    const items = yield* mapRepoError(repo.listItems(record.id));

    if (items.length === 0) {
      return yield* Effect.fail(
        new SafetyVerificationValidationError({
          message: 'Choose at least one check before starting.'
        })
      );
    }

    const quote = yield* payments.quote(toLineItems(items, types));
    const authorisation = yield* payments
      .authorise({
        userId,
        quote,
        // The record id is the idempotency key: a retried request resolves to
        // the same authorisation instead of charging twice.
        idempotencyKey: record.id
      })
      .pipe(
        Effect.catchTags({
          PaymentDeclinedError: (error) =>
            Effect.fail(new SafetyVerificationPaymentError({ reason: error.reason })),
          PaymentProviderError: () =>
            Effect.fail(
              new SafetyVerificationPaymentError({ reason: 'Payment could not be processed.' })
            )
        })
      );

    // The itemised breakdown is frozen here and never recomputed for display,
    // so a later fee or tax change cannot rewrite what somebody was charged.
    const paid = yield* mapRepoError(
      repo.update(record.id, {
        // The basket becomes a paid order — same row, so the items travel with
        // it and live-record uniqueness never has two rows to reconcile.
        status: 'payment_pending',
        route: 'credibled',
        paymentReference: authorisation.reference,
        amountCents: quote.amountCents,
        feeCents: quote.feeCents,
        taxCents: quote.taxCents,
        totalCents: quote.totalCents,
        consentAt: record.consentAt ?? now,
        consentPolicyVersion: record.consentPolicyVersion ?? policy.consentPolicyVersion
      })
    );

    // Ordering happens in the worker so a Credibled outage is a retry rather
    // than a lost payment. The queue dedupes on the verification id.
    yield* queue
      .enqueueOrder({ verificationId: paid.id })
      .pipe(
        Effect.catchTag('SafetyVerificationQueueError', (error) =>
          Effect.fail(new SafetyVerificationQueueingError({ cause: error.cause }))
        )
      );

    return { verification: toApplicantSummary(paid, today()) };
  });

export const submitSafetyDocumentRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, safetyVerificationJsonError);
    const input = yield* validateSafetyVerificationDocumentInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      safetyVerification: ['write']
    })(authenticated);
    const role = yield* applicantRole(userAndSession);
    const userId = userAndSession.user.id;

    yield* ensureOwnFileKey(userId, input.fileKey);

    const currentDate = today();
    if (input.issuedOn > currentDate) {
      return yield* Effect.fail(
        new SafetyVerificationValidationError({ message: 'Issue date cannot be in the future.' })
      );
    }
    if (input.expiresOn <= currentDate) {
      return yield* Effect.fail(
        new SafetyVerificationValidationError({
          message: 'The document has already expired — submit a current one.'
        })
      );
    }
    if (input.expiresOn <= input.issuedOn) {
      return yield* Effect.fail(
        new SafetyVerificationValidationError({
          message: 'Valid-until date must be after the issue date.'
        })
      );
    }

    const repo = yield* SafetyVerificationRepo;
    const policy = yield* policyConfig;
    const existing = yield* mapRepoError(repo.findLive(userId, role));
    if (existing !== null && !canStartNewVerification(existing)) {
      return yield* Effect.fail(
        new SafetyVerificationConflictError({
          message: 'A safety verification is already in progress for this account.'
        })
      );
    }

    // `review_required`, never `verified`. An uploaded document is an
    // assertion by the applicant; only an administrator turns it into a
    // verification, which is why every surface labels this "submitted for
    // review".
    const fields = {
      status: 'review_required' as const,
      route: 'uploaded_document' as const,
      consentAt: new Date(),
      consentPolicyVersion: policy.consentPolicyVersion,
      issuingAuthority: input.issuingAuthority,
      documentNumber: input.documentNumber,
      filename: input.filename,
      fileKey: input.fileKey,
      issuedOn: input.issuedOn,
      expiresOn: input.expiresOn
    };

    // A `not_started` row with items is a LIVE Credibled basket, not an
    // abandoned one. Reusing it would silently discard checks the applicant
    // has queued, so refuse and let them decide — losing their selection
    // without saying so is the one outcome that isn't recoverable.
    if (existing !== null && existing.status === 'not_started') {
      const queued = yield* mapRepoError(repo.listItems(existing.id));
      if (queued.length > 0) {
        return yield* Effect.fail(
          new SafetyVerificationConflictError({
            message:
              'You have checks waiting to be fetched by Credibled. Remove them from your check list first, or pay for them, then upload this document.'
          })
        );
      }
    }

    // An empty `not_started` row is an abandoned basket. Reuse it rather than
    // inserting — the partial unique index allows only one live record per
    // (user, role), so a second insert would 500.
    const record =
      existing !== null
        ? yield* mapRepoError(repo.update(existing.id, fields))
        : yield* mapRepoError(repo.create({ userId, role, ...fields }));

    return { verification: toApplicantSummary(record, currentDate) };
  });

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const listSafetyVerificationsForReviewRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { safetyVerification: ['review'] })(authenticated);

    const repo = yield* SafetyVerificationRepo;
    const records = yield* mapRepoError(repo.listForReview());
    const currentDate = today();

    return { verifications: records.map((record) => toAdminSummary(record, currentDate)) };
  });

export const decideSafetyVerificationRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  id: string
) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, safetyVerificationDecisionJsonError);
    const input = yield* validateSafetyVerificationDecisionInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      safetyVerification: ['review']
    })(authenticated);

    const repo = yield* SafetyVerificationRepo;
    const policy = yield* policyConfig;
    const record = yield* mapRepoError(repo.findById(id));

    // Only records actually awaiting a decision can be decided. Without this,
    // a replayed request could re-approve a rejected record or overwrite a
    // decision somebody else already made.
    if (record.status !== 'review_required') {
      return yield* Effect.fail(
        new SafetyVerificationConflictError({
          message: 'This verification is not awaiting a decision.'
        })
      );
    }

    const reason = input.reason?.trim() ?? '';
    if (input.decision === 'reject' && reason.length === 0) {
      return yield* Effect.fail(
        new SafetyVerificationValidationError({
          message: 'A rejection must say why — the applicant sees this.'
        })
      );
    }

    const currentDate = today();
    const now = new Date();

    if (input.decision === 'reject') {
      const rejected = yield* mapRepoError(
        repo.update(record.id, {
          status: 'rejected',
          reviewedBy: userAndSession.user.id,
          reviewedAt: now,
          decisionReason: reason
        })
      );
      return { verification: toAdminSummary(rejected, currentDate) };
    }

    // Approval needs an expiry. An uploaded document carries its own (the
    // admin may correct it); a Credibled check has none, so policy supplies
    // one measured from the decision.
    // Uses the same clamped arithmetic as the webhook path — raw month
    // addition turns 31 Jan + 1 month into 3 March.
    const expiresOn =
      input.expiresOn ?? record.expiresOn ?? expiryFromCompletion(now, policy.validityMonths);

    if (expiresOn <= currentDate) {
      return yield* Effect.fail(
        new SafetyVerificationValidationError({
          message: 'Cannot approve with an expiry date in the past.'
        })
      );
    }

    const approved = yield* mapRepoError(
      repo.update(record.id, {
        status: 'verified',
        reviewedBy: userAndSession.user.id,
        reviewedAt: now,
        decisionReason: reason.length > 0 ? reason : null,
        expiresOn,
        // A fresh decision restarts the reminder clock.
        expiryNotifiedAt: null
      })
    );

    return { verification: toAdminSummary(approved, currentDate) };
  });

/**
 * Report bytes for an administrator.
 *
 * Fetched from Credibled on demand and streamed straight through — never
 * written to our object storage, never cached, never exposed to any other
 * user. This is the only place criminal-record detail crosses Poppynz at all.
 */
export const getSafetyVerificationReportRouteProgram = (headers: Headers, id: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { safetyVerification: ['review'] })(authenticated);

    const repo = yield* SafetyVerificationRepo;
    const credibled = yield* Credibled;
    const record = yield* mapRepoError(repo.findById(id));

    if (!record.credibledCheckUuid) {
      return yield* Effect.fail(new SafetyVerificationNotFoundError());
    }

    const pdf = yield* credibled
      .getReportPdf(credibledAudienceForRole(record.role), record.credibledCheckUuid)
      .pipe(
        Effect.catchTags({
          CredibledNotConfiguredError: () =>
            Effect.fail(
              new SafetyVerificationVendorError({ reason: 'Credibled is not configured.' })
            ),
          CredibledRequestError: () =>
            Effect.fail(
              new SafetyVerificationVendorError({ reason: 'Credibled report is unavailable.' })
            )
        })
      );

    return pdf;
  });

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

type SafetyVerificationRouteError =
  | Effect.Effect.Error<ReturnType<typeof getMySafetyVerificationRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof addSafetyVerificationItemRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof removeSafetyVerificationItemRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof orderSafetyCheckRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof submitSafetyDocumentRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listSafetyVerificationsForReviewRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof decideSafetyVerificationRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getSafetyVerificationReportRouteProgram>>;

const errorToResponse = (c: HonoContext<HonoEnv>, error: SafetyVerificationRouteError) => {
  if (isAuthError(error)) {
    return authErrorToResponse(c, error);
  }
  if (isRequestValidationError(error)) {
    return requestValidationErrorToResponse(c, error);
  }

  switch (error._tag) {
    case 'SafetyVerificationValidationError':
      return c.json(
        { error: { code: 'INVALID_SAFETY_VERIFICATION_INPUT' as const, message: error.message } },
        422
      );
    case 'SafetyVerificationConflictError':
      return c.json(
        { error: { code: 'SAFETY_VERIFICATION_CONFLICT' as const, message: error.message } },
        409
      );
    case 'SafetyVerificationNotFoundError':
      return c.json(
        {
          error: {
            code: 'SAFETY_VERIFICATION_NOT_FOUND' as const,
            message: 'Safety verification not found.'
          }
        },
        404
      );
    case 'SafetyVerificationRoleError':
      return c.json(
        {
          error: {
            code: 'SAFETY_VERIFICATION_ROLE_UNSUPPORTED' as const,
            message: 'Only families and service providers are screened.'
          }
        },
        403
      );
    case 'SafetyVerificationPaymentError':
      return c.json(
        { error: { code: 'SAFETY_VERIFICATION_PAYMENT_FAILED' as const, message: error.reason } },
        402
      );
    case 'SafetyVerificationVendorError':
      return c.json(
        { error: { code: 'SAFETY_VERIFICATION_UNAVAILABLE' as const, message: error.reason } },
        503
      );
    case 'SafetyVerificationQueueingError':
    case 'SafetyVerificationRepoError':
      return c.json(
        {
          error: {
            code: 'INTERNAL_SERVER_ERROR' as const,
            message: 'Unexpected server error.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, SafetyVerificationRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return errorToResponse(c, failure.value);
      }
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function getMySafetyVerificationHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(
    getMySafetyVerificationRouteProgram(c.req.raw.headers)
  );
  return exitToResponse(c, exit);
}

export async function addSafetyVerificationItemHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(
    addSafetyVerificationItemRouteProgram(c, c.req.raw.headers)
  );
  return exitToResponse(c, exit);
}

export async function removeSafetyVerificationItemHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const itemId = c.req.param('itemId') ?? '';
  const exit = await runtime.runPromiseExit(
    removeSafetyVerificationItemRouteProgram(c.req.raw.headers, itemId)
  );
  return exitToResponse(c, exit);
}

export async function orderSafetyCheckHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(orderSafetyCheckRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function submitSafetyDocumentHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(submitSafetyDocumentRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function listSafetyVerificationsForReviewHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(
    listSafetyVerificationsForReviewRouteProgram(c.req.raw.headers)
  );
  return exitToResponse(c, exit);
}

export async function decideSafetyVerificationHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(
    decideSafetyVerificationRouteProgram(c, c.req.raw.headers, id)
  );
  return exitToResponse(c, exit);
}

export async function getSafetyVerificationReportHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(
    getSafetyVerificationReportRouteProgram(c.req.raw.headers, id)
  );

  return Exit.match(exit, {
    onSuccess: (pdf) =>
      c.body(pdf as unknown as ArrayBuffer, 200, {
        'content-type': 'application/pdf',
        // Screening reports must never sit in a shared cache or a browser's
        // disk cache alongside ordinary page assets.
        'cache-control': 'no-store, private',
        'content-disposition': `inline; filename="safety-verification-${id}.pdf"`
      }),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return errorToResponse(c, failure.value);
      }
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });
}
