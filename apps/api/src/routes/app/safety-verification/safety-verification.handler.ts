import type { SqlError } from '@effect/sql/SqlError';
import { cardOnFile, ensureBillingCustomer, settlePayment, toCard } from '@repo/billing';
import { credibledCheckTypeClub, credibledCheckTypeLabel, Credibled } from '@repo/credibled';
import {
  CheckOrderRepo,
  DBNotFoundError,
  KycDocumentTypeRepo,
  PaymentRepo,
  SafetyVerificationRepo,
  isSettledPayment,
  type BillingCard,
  type CheckOrder,
  type CheckOrderClaimInput,
  type CheckOrderItem,
  type KycDocumentType,
  type Payment,
  type SafetyVerificationRole
} from '@repo/db';
import { safetyVerificationConfig } from '@repo/env';
import {
  Payments,
  type Money,
  type PaymentProviderError,
  type QuoteLineItem,
  type StartedPayment
} from '@repo/payments';
import { SafetyVerificationQueue, type SafetyVerificationQueueError } from '@repo/queue';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { scheduleFamilySearchReconcile } from '@/api/lib/family-search-jobs';
import {
  AuthService,
  authErrorToResponse,
  authenticate,
  handleNever,
  isAuthError,
  requirePermissions,
  type UserAndSession
} from '@/api/lib/effect-auth';
import {
  byReviewPriority,
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
  validateSafetyVerificationConfirmInput,
  validateSafetyVerificationDecisionInput,
  validateSafetyVerificationDocumentInput,
  validateSafetyVerificationItemInput,
  validateSafetyVerificationOrderInput
} from './safety-verification.validator';
import { publishNotificationBestEffort } from '@repo/notify';

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

const PAYMENTS_UNAVAILABLE = 'Payments are temporarily unavailable. Please try again shortly.';

/** The provider (or our record of the customer) could not be reached. */
const mapPaymentServiceError = <A, R>(
  effect: Effect.Effect<A, SqlError | PaymentProviderError, R>
): Effect.Effect<A, SafetyVerificationRepoError | SafetyVerificationVendorError, R> =>
  effect.pipe(
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new SafetyVerificationRepoError({ cause })),
      PaymentProviderError: () =>
        Effect.fail(new SafetyVerificationVendorError({ reason: PAYMENTS_UNAVAILABLE }))
    })
  );

/** Everything the shared settle path can fail with, as route errors. */
const mapSettleError = <A, R>(
  effect: Effect.Effect<
    A,
    SqlError | DBNotFoundError | PaymentProviderError | SafetyVerificationQueueError,
    R
  >
): Effect.Effect<
  A,
  | SafetyVerificationRepoError
  | SafetyVerificationNotFoundError
  | SafetyVerificationVendorError
  | SafetyVerificationQueueingError,
  R
> =>
  effect.pipe(
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new SafetyVerificationRepoError({ cause })),
      DBNotFoundError: () => Effect.fail(new SafetyVerificationNotFoundError()),
      PaymentProviderError: () =>
        Effect.fail(new SafetyVerificationVendorError({ reason: PAYMENTS_UNAVAILABLE })),
      SafetyVerificationQueueError: (error) =>
        Effect.fail(new SafetyVerificationQueueingError({ cause: error.cause }))
    })
  );

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
  items: Array<CheckOrderItem>,
  types: Array<KycDocumentType>
): Array<QuoteLineItem> =>
  items.map((item) => ({
    label: types.find((type) => type.id === item.documentTypeId)?.name ?? 'Check',
    // The FROZEN cost from the item, never the type's current price — an admin
    // editing pricing mid-basket must not change what was quoted.
    costCents: item.costCents
  }));

/** The basket only exists while an order has not been paid for. */
const basketFor = (order: CheckOrder | null) =>
  order !== null && order.status === 'draft' ? order : null;

const alreadyInProgress = () =>
  new SafetyVerificationConflictError({
    message: 'A safety verification is already in progress for this account.'
  });

/** A row the caller expects to exist but can tolerate missing — a payment or
 * order purged from under a verdict resolves to null, not to a 404 on the
 * whole page. */
const orNull = <A, R>(
  effect: Effect.Effect<A, SqlError | DBNotFoundError, R>
): Effect.Effect<A | null, SqlError, R> =>
  effect.pipe(Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)));

export const getMySafetyVerificationRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      safetyVerification: ['read']
    })(authenticated);
    const role = yield* applicantRole(userAndSession);

    const repo = yield* SafetyVerificationRepo;
    const orders = yield* CheckOrderRepo;
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;
    const credibled = yield* Credibled;
    const typeRepo = yield* KycDocumentTypeRepo;
    const policy = yield* policyConfig;

    const [record, openOrder, types] = yield* Effect.all(
      [
        mapRepoError(repo.findLive(userAndSession.user.id, role)),
        mapRepoError(orders.findOpen(userAndSession.user.id, role)),
        mapRepoError(typeRepo.listActive())
      ],
      { concurrency: 'unbounded' }
    );

    // The order the page is about: the open one if there is one, otherwise
    // the one the verdict came out of (so a reviewed Credibled check still
    // shows what was ordered and paid).
    const order =
      openOrder ??
      (record?.checkOrderId
        ? yield* mapRepoError(orNull(orders.findById(record.checkOrderId)))
        : null);
    const payment = order?.paymentId
      ? yield* mapRepoError(orNull(paymentRepo.findById(order.paymentId)))
      : null;

    const items = order ? yield* mapRepoError(orders.listItems(order.id)) : [];
    const quote = yield* payments.quote(toLineItems(items, types), policy);

    // Which Credibled checks this role's document types map onto. Empty means
    // ordering is unavailable and only the upload route is offered.
    const orderableCheckTypes = types
      .filter((type) => isOrderable(type, role))
      .map((type) => ({
        documentTypeId: type.id,
        name: type.name,
        credibledCheckTypeValue: type.credibledCheckTypeValue as string,
        credibledLabel: credibledCheckTypeLabel(type.credibledCheckTypeValue as string),
        costCents: type.credibledCostCents as number,
        selected: items.some((item) => item.documentTypeId === type.id)
      }));

    return {
      verification: toApplicantSummary({ verification: record, order, payment }, today()),
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
        orderableCheckTypes.length > 0 && credibled.isConfigured(credibledAudienceForRole(role)),
      // A payment was started and the payer never finished confirming it
      // (tab closed, 3-D Secure abandoned): ordering again resumes it.
      canResumePayment: openOrder?.status === 'payment_pending' && payment?.status === 'pending'
    };
  });

// ---------------------------------------------------------------------------
// Basket
// ---------------------------------------------------------------------------

export const addSafetyVerificationItemRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
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
    const orders = yield* CheckOrderRepo;
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

    const [verification, openOrder] = yield* Effect.all(
      [mapRepoError(repo.findLive(userId, role)), mapRepoError(orders.findOpen(userId, role))],
      { concurrency: 'unbounded' }
    );
    // A live verdict (awaiting review or verified) or an order past the
    // basket stage both mean the list is closed.
    if (verification !== null || (openOrder !== null && openOrder.status !== 'draft')) {
      return yield* Effect.fail(alreadyInProgress());
    }

    // The basket IS a draft order, created on first add.
    const order =
      openOrder ??
      (yield* mapRepoError(
        orders.create({
          userId,
          role,
          status: 'draft',
          consentPolicyVersion: policy.consentPolicyVersion
        })
      ));

    const items = yield* mapRepoError(orders.listItems(order.id));
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
      orders.addItem({
        orderId: order.id,
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

    const orders = yield* CheckOrderRepo;
    const order = basketFor(yield* mapRepoError(orders.findOpen(userAndSession.user.id, role)));
    if (!order) {
      return yield* Effect.fail(
        new SafetyVerificationConflictError({
          message: 'Your check list can no longer be changed.'
        })
      );
    }

    // Scoped to the caller's own order, so an id from somebody else's basket
    // resolves to not-found rather than deleting their item.
    yield* mapRepoError(orders.removeItem(order.id, itemId));
    return { removed: itemId };
  });

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
    const orders = yield* CheckOrderRepo;
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;
    const credibled = yield* Credibled;
    const typeRepo = yield* KycDocumentTypeRepo;
    const authService = yield* AuthService;
    const policy = yield* policyConfig;

    const audience = credibledAudienceForRole(role);
    if (!credibled.isConfigured(audience)) {
      return yield* Effect.fail(
        new SafetyVerificationVendorError({
          reason: 'Ordering is not available for this account yet.'
        })
      );
    }

    const [types, verification, openOrder] = yield* Effect.all(
      [
        mapRepoError(typeRepo.listActive()),
        mapRepoError(repo.findLive(userId, role)),
        mapRepoError(orders.findOpen(userId, role))
      ],
      { concurrency: 'unbounded' }
    );

    if (verification !== null) {
      return yield* Effect.fail(alreadyInProgress());
    }
    // Ordering settles an existing basket — there is nothing to charge for
    // until the applicant has chosen at least one check.
    if (openOrder === null) {
      return yield* Effect.fail(
        new SafetyVerificationValidationError({
          message: 'Choose at least one check before starting.'
        })
      );
    }

    // Only a basket, or a previous attempt at paying for one, can be paid for.
    if (openOrder.status !== 'draft' && openOrder.status !== 'payment_pending') {
      return yield* Effect.fail(alreadyInProgress());
    }

    const items = yield* mapRepoError(orders.listItems(openOrder.id));
    if (items.length === 0) {
      return yield* Effect.fail(
        new SafetyVerificationValidationError({
          message: 'Choose at least one check before starting.'
        })
      );
    }

    const quote = yield* payments.quote(toLineItems(items, types), policy);

    // Who keeps a card on file for later (contract billing) is a permission,
    // not a role check: families hold billing:write, helpers pay one-off.
    const keepsCard = yield* authService.userHasPermission(headers, { billing: ['write'] });

    /** The payer still has to confirm in the browser (card form, 3-D Secure,
     * or one click with the saved card). */
    const paymentRequired = (
      payment: Payment,
      started: StartedPayment,
      card: BillingCard | null
    ) => ({
      status: 'payment_required' as const,
      paymentId: payment.id,
      clientSecret: started.clientSecret,
      provider: payments.provider,
      // The row's frozen total — what the provider charges — never the live
      // quote, which a fee or price change since the row was made would move.
      totalCents: payment.totalCents,
      // A family paying with a new card keeps it: the modal says so.
      savesCard: keepsCard && card === null,
      // Only when the intent really carries the saved card — the modal's
      // one-click button confirms without collecting anything.
      savedCard:
        card !== null && started.paymentMethodReference === card.reference
          ? {
              brand: card.brand,
              last4: card.last4,
              expMonth: card.expMonth,
              expYear: card.expYear
            }
          : null
    });

    /** Money is taken and settle moved the order on: the existing summary. */
    const paidResponse = (orderId: string, payment: Payment) =>
      Effect.gen(function* () {
        const order = yield* orders.findById(orderId).pipe((errors) => mapRepoError(errors));
        return {
          status: 'paid' as const,
          verification: toApplicantSummary({ verification: null, order, payment }, today())
        };
      });

    /** The provider says the payment finished (the mock settles at once):
     * record it through the one settle path, then answer with what it did. */
    const settleAndRespond = (
      order: CheckOrder,
      payment: Payment,
      started: StartedPayment,
      card: BillingCard | null
    ) =>
      Effect.gen(function* () {
        const result = yield* settlePayment(payment.id).pipe((errors) => mapSettleError(errors));
        if (isSettledPayment(result.payment)) {
          return yield* paidResponse(order.id, result.payment);
        }
        if (result.payment.status === 'failed') {
          return yield* Effect.fail(
            new SafetyVerificationPaymentError({
              reason: result.payment.lastError ?? 'The payment was declined.'
            })
          );
        }
        return paymentRequired(result.payment, started, card);
      });

    /** Records the intent on its row — only while the row is pending with no
     * intent yet (or this very one: the same key gives the same intent). A
     * concurrent request that recorded a DIFFERENT intent owns the row: ours
     * is cancelled so it can never be paid, and nothing is handed out. */
    const recordStarted = (payment: Payment, started: StartedPayment) =>
      Effect.gen(function* () {
        const written = yield* paymentRepo
          .advance(payment.id, {
            from: 'pending',
            providerReference: null,
            set: { providerReference: started.reference, lastError: null }
          })
          .pipe((errors) => mapRepoError(errors));
        if (written !== null) return written;
        const current = yield* mapRepoError(orNull(paymentRepo.findById(payment.id)));
        if (current !== null && current.providerReference === started.reference) return current;
        yield* payments
          .cancelPayment(started.reference)
          .pipe(
            Effect.catchAll((error) =>
              Effect.logWarning(`could not cancel superseded intent for ${payment.id}`, error)
            )
          );
        return yield* Effect.fail(
          new SafetyVerificationConflictError({
            message: 'Your previous payment is still being processed. Check back in a few minutes.'
          })
        );
      });

    /** Ask the provider to start a payment against a payment row. */
    const charge = (claimed: CheckOrder, payment: Payment) =>
      Effect.gen(function* () {
        const declined = (reason: string) =>
          Effect.gen(function* () {
            // Release the order so the applicant can try again with a fresh
            // charge; the failed row stays as the record of the attempt.
            // Both writes are guarded: the row only while it is still pending
            // with no intent recorded (a concurrent request may have handed
            // one to the browser), the revert only for OUR payment so it
            // cannot clobber a re-claim that got in first.
            const failed = yield* paymentRepo
              .advance(payment.id, {
                from: 'pending',
                providerReference: null,
                set: { status: 'failed', lastError: reason }
              })
              .pipe((errors) => mapRepoError(errors));
            if (failed !== null) {
              yield* orders
                .advance(claimed.id, {
                  from: { status: 'payment_pending', paymentId: payment.id },
                  set: { status: 'draft', paymentId: null }
                })
                .pipe((errors) => mapRepoError(errors));
            }
            return yield* Effect.fail(new SafetyVerificationPaymentError({ reason }));
          });

        const customer = keepsCard
          ? yield* ensureBillingCustomer({
              id: userId,
              email: userAndSession.user.email,
              name: userAndSession.user.name
            }).pipe((errors) => mapPaymentServiceError(errors))
          : null;
        const card = toCard(customer, payments.provider);

        // The row's own breakdown is what the provider is charged — never the
        // freshly computed quote. On a fresh row the two agree; on a restart
        // (provider never reached) the row was frozen at an earlier attempt,
        // and a fee/tax/price change since then must not charge a different
        // amount than the row records, or settle's mismatch check flags a
        // captured payment as unresolved.
        const frozenQuote: Money = {
          amountCents: payment.amountCents,
          lineItems: quote.lineItems,
          feeCents: payment.feeCents,
          taxCents: payment.taxCents,
          totalCents: payment.totalCents,
          currency: payment.currency as Money['currency']
        };

        // The payment row's id is the idempotency key: a retry against the
        // same row is the same intent at the provider, never a second one.
        // The card choices are part of it, because the provider refuses a
        // reused key sent with different parameters — and a restart can
        // choose differently (a card added or replaced since). A different
        // choice is a different intent; recording it below is guarded so it
        // can never overwrite one already handed to the browser.
        const cardChoice = card !== null ? `-card-${card.reference}` : keepsCard ? '-save' : '';
        const started = yield* payments
          .startPayment({
            quote: frozenQuote,
            idempotencyKey: `${payment.id}${cardChoice}`,
            metadata: { payment_id: payment.id, order_id: claimed.id, kind: payment.kind },
            customer: customer?.customerReference ?? null,
            savedCard: card?.reference ?? null,
            // A family's first card is kept for contract billing.
            saveCard: keepsCard && card === null
          })
          .pipe(
            Effect.catchTags({
              PaymentDeclinedError: (error) => declined(error.reason),
              // Not an answer about the card. The provider may still have
              // created the intent (a timeout, or a concurrent request holding
              // the same key that has already handed it to the browser), so
              // the row stays pending with no reference and the order stays
              // claimed: the next attempt restarts with the same key and gets
              // that same intent, never a second charge.
              PaymentProviderError: () =>
                Effect.fail(new SafetyVerificationVendorError({ reason: PAYMENTS_UNAVAILABLE }))
            })
          );

        const recorded = yield* recordStarted(payment, started);

        return started.status === 'succeeded'
          ? yield* settleAndRespond(claimed, recorded, started, card)
          : paymentRequired(recorded, started, card);
      });

    /** A fresh payment row, and the order claimed for it. Compare-and-set:
     * two concurrent requests can both reach here with the same draft, but
     * only one claim lands. The loser's row never reaches the provider, so it
     * is closed out rather than left pending. */
    const claimWithNewPayment = (from: CheckOrderClaimInput['from']) =>
      Effect.gen(function* () {
        // The row exists BEFORE the provider is asked for money. The itemised
        // breakdown is frozen here and never recomputed for display, so a
        // later fee or tax change cannot rewrite what somebody was charged.
        const payment = yield* mapRepoError(
          paymentRepo.create({
            userId,
            kind: 'credibled_order',
            provider: payments.provider,
            amountCents: quote.amountCents,
            feeCents: quote.feeCents,
            taxCents: quote.taxCents,
            totalCents: quote.totalCents,
            currency: quote.currency
          })
        );
        const claimed = yield* mapRepoError(
          orders.claimForPayment(openOrder.id, { paymentId: payment.id, from })
        );
        if (claimed === null) {
          yield* paymentRepo
            .update(payment.id, {
              status: 'failed',
              lastError: 'order was claimed by a concurrent request'
            })
            .pipe(Effect.ignore);
          return yield* Effect.fail(alreadyInProgress());
        }
        return yield* charge(claimed, payment);
      });

    if (openOrder.status === 'draft') {
      return yield* claimWithNewPayment({ status: 'draft', paymentId: openOrder.paymentId });
    }

    // An order left in `payment_pending` is a previous attempt that never
    // finished. Its payment row says which kind, and each is recoverable —
    // a stale claim must never lock the applicant out, and a charge that
    // landed must never be taken again:
    //   - settled: settle finishes the job with the money already taken;
    //   - pending, provider never reached: start again with the SAME row and
    //     key, so the provider sees one intent, not two;
    //   - pending at the provider: resume that intent with a fresh client
    //     secret — never a second intent;
    //   - failed (or gone): start over with a fresh row, claiming from exactly
    //     the state we saw.
    const previous = openOrder.paymentId
      ? yield* mapRepoError(orNull(paymentRepo.findById(openOrder.paymentId)))
      : null;
    if (previous !== null && isSettledPayment(previous)) {
      const result = yield* settlePayment(previous.id).pipe((errors) => mapSettleError(errors));
      return yield* paidResponse(openOrder.id, result.payment);
    }
    if (
      previous !== null &&
      previous.status === 'pending' &&
      previous.provider !== payments.provider
    ) {
      // Left by another gateway (PAYMENTS_PROVIDER switched, or rolled back).
      // Neither restarting nor resuming it can work here: a restart would
      // record this gateway's intent on a row settle, the webhook and the
      // recovery job all skip as another provider's, and a resume would send
      // the old gateway's reference to this one. Close it out — guarded, in
      // case a concurrent request got there first — and charge afresh.
      const abandoned = yield* paymentRepo
        .advance(previous.id, {
          from: 'pending',
          set: { status: 'failed', lastError: 'abandoned at provider switch' }
        })
        .pipe((errors) => mapRepoError(errors));
      if (abandoned === null) return yield* Effect.fail(alreadyInProgress());
      return yield* claimWithNewPayment({ status: 'payment_pending', paymentId: previous.id });
    }
    if (previous !== null && previous.status === 'pending') {
      if (previous.providerReference === null) {
        return yield* charge(openOrder, previous);
      }
      const resumed = yield* payments
        .resumePayment(previous.providerReference)
        .pipe((errors) => mapPaymentServiceError(errors));
      if (resumed.status === 'requires_action') {
        const card = keepsCard
          ? yield* cardOnFile(userId).pipe((errors) => mapPaymentServiceError(errors))
          : null;
        return paymentRequired(previous, resumed, card);
      }
      // The provider already decided. Record it; a failure released the
      // order, so this request starts a fresh payment for the same basket.
      const result = yield* settlePayment(previous.id).pipe((errors) => mapSettleError(errors));
      if (isSettledPayment(result.payment)) {
        return yield* paidResponse(openOrder.id, result.payment);
      }
      if (result.payment.status === 'failed') {
        return yield* claimWithNewPayment({ status: 'draft', paymentId: null });
      }
      return yield* Effect.fail(
        new SafetyVerificationConflictError({
          message: 'Your previous payment is still being processed. Check back in a few minutes.'
        })
      );
    }
    return yield* claimWithNewPayment({
      status: 'payment_pending',
      paymentId: openOrder.paymentId
    });
  });

/** Called by the payment modal once the browser has confirmed (or failed to
 * confirm). Never trusts the browser: it settles from the provider's state. */
export const confirmSafetyCheckPaymentRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, safetyVerificationJsonError);
    const input = yield* validateSafetyVerificationConfirmInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      safetyVerification: ['write']
    })(authenticated);
    yield* applicantRole(userAndSession);

    const paymentRepo = yield* PaymentRepo;
    const payment = yield* paymentRepo
      .findById(input.paymentId)
      .pipe((errors) => mapRepoError(errors));
    // Owner only — somebody else's payment id reads as not found.
    if (payment.userId !== userAndSession.user.id) {
      return yield* Effect.fail(new SafetyVerificationNotFoundError());
    }

    const result = yield* settlePayment(payment.id).pipe((errors) => mapSettleError(errors));
    if (isSettledPayment(result.payment)) {
      return { status: 'paid' as const, message: null };
    }
    if (result.payment.status === 'failed') {
      return {
        status: 'failed' as const,
        message: result.payment.lastError ?? 'The payment was declined.'
      };
    }
    return { status: 'pending' as const, message: null };
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
    const orders = yield* CheckOrderRepo;
    const policy = yield* policyConfig;
    const [verification, openOrder] = yield* Effect.all(
      [mapRepoError(repo.findLive(userId, role)), mapRepoError(orders.findOpen(userId, role))],
      { concurrency: 'unbounded' }
    );
    if (verification !== null) {
      return yield* Effect.fail(alreadyInProgress());
    }
    if (openOrder !== null) {
      if (openOrder.status !== 'draft') {
        return yield* Effect.fail(alreadyInProgress());
      }
      // A draft with items is a LIVE Credibled basket, not an abandoned one.
      // Proceeding would strand checks the applicant has queued, so refuse
      // and let them decide — losing their selection without saying so is
      // the one outcome that isn't recoverable. An EMPTY draft is inert and
      // simply stays where it is.
      const queued = yield* mapRepoError(orders.listItems(openOrder.id));
      if (queued.length > 0) {
        return yield* Effect.fail(
          new SafetyVerificationConflictError({
            message:
              'You have checks waiting to be fetched by Credibled. Remove them from your check list first, or pay for them, then upload this document.'
          })
        );
      }
    }

    // `review_required`, never `verified`. An uploaded document is an
    // assertion by the applicant; only an administrator turns it into a
    // verification, which is why every surface labels this "submitted for
    // review".
    const record = yield* mapRepoError(
      repo.create({
        userId,
        role,
        status: 'review_required',
        route: 'uploaded_document',
        consentAt: new Date(),
        consentPolicyVersion: policy.consentPolicyVersion,
        issuingAuthority: input.issuingAuthority,
        documentNumber: input.documentNumber,
        filename: input.filename,
        fileKey: input.fileKey,
        issuedOn: input.issuedOn,
        expiresOn: input.expiresOn
      })
    );

    return {
      verification: toApplicantSummary(
        { verification: record, order: null, payment: null },
        currentDate
      )
    };
  });

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const listSafetyVerificationsForReviewRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { safetyVerification: ['review'] })(authenticated);

    const repo = yield* SafetyVerificationRepo;
    const orders = yield* CheckOrderRepo;
    const records = yield* mapRepoError(repo.listForReview());
    const orderIds = records.flatMap((record) =>
      record.checkOrderId ? [record.checkOrderId] : []
    );
    const withItems = yield* mapRepoError(orders.listWithItems(orderIds));
    const currentDate = today();

    const verifications = records
      .map((record) =>
        toAdminSummary(
          record,
          currentDate,
          withItems.find((order) => order.id === record.checkOrderId) ?? null
        )
      )
      .sort(byReviewPriority);

    return { verifications };
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

    // A family's discoverability rides directly on this verdict (providers'
    // rides on their approval, which already requires it), so a decision
    // either way re-indexes them. Best-effort: the read path re-verifies.
    const reindex =
      record.role === 'family' ? scheduleFamilySearchReconcile(record.userId) : Effect.void;

    if (input.decision === 'reject') {
      const rejected = yield* mapRepoError(
        repo.update(record.id, {
          status: 'rejected',
          reviewedBy: userAndSession.user.id,
          reviewedAt: now,
          decisionReason: reason
        })
      );
      yield* reindex;
      yield* publishNotificationBestEffort(record.userId, {
        type: 'safety_verification.updated',
        payload: { status: 'rejected' }
      });
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
    yield* reindex;
    yield* publishNotificationBestEffort(record.userId, {
      type: 'safety_verification.updated',
      payload: { status: 'verified' }
    });

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
    const orders = yield* CheckOrderRepo;
    const credibled = yield* Credibled;
    const record = yield* mapRepoError(repo.findById(id));

    // Only a verdict that came out of a Credibled order has a report.
    const order = record.checkOrderId
      ? yield* mapRepoError(orNull(orders.findById(record.checkOrderId)))
      : null;
    if (!order?.credibledCheckUuid) {
      return yield* Effect.fail(new SafetyVerificationNotFoundError());
    }

    const pdf = yield* credibled
      .getReportPdf(credibledAudienceForRole(record.role), order.credibledCheckUuid)
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
  | Effect.Effect.Error<ReturnType<typeof confirmSafetyCheckPaymentRouteProgram>>
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

const exitToResponse = <T>(
  c: HonoContext<HonoEnv>,
  exit: Exit.Exit<T, SafetyVerificationRouteError>
) =>
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
  const exit = await runtime.runPromiseExit(getMySafetyVerificationRouteProgram(c.req.raw.headers));
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

export async function confirmSafetyCheckPaymentHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(
    confirmSafetyCheckPaymentRouteProgram(c, c.req.raw.headers)
  );
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
