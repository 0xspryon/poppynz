import { applyCardSetup, mismatchReason, settlePaymentByReference } from '@repo/billing';
import { PaymentRepo, StripeWebhookEventRepo } from '@repo/db';
import { Payments, type PaymentWebhookEvent } from '@repo/payments';
import { Cause, Effect, Exit } from 'effect';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { BaseAppEnv, HonoContext } from '@/api/app-env';

/**
 * Stripe webhooks.
 *
 * Mounted OUTSIDE the authenticated app router: public ingress with no
 * session, so every guarantee comes from the signature and from how events
 * are applied. A delivery is a wake-up signal, nothing more:
 *
 *   1. The `Stripe-Signature` is verified over the RAW body. Enforcement is
 *      never disabled — no secret configured means every delivery is refused.
 *   2. The event id is recorded; a delivery we already processed is
 *      acknowledged and dropped (Stripe delivers at least once).
 *   3. The handler re-fetches the object from Stripe and acts only on that,
 *      through the same settle path the browser and the recovery job use.
 *   4. A processing failure is recorded and answered 500, so Stripe retries.
 */

/** Stripe events are a few kilobytes; anything near this is not one. */
const MAX_BODY_BYTES = 512 * 1024;

const paymentIntentEvents = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'payment_intent.processing'
]);

/** A charge was refunded. Only a FULL refund moves our row (the worker's
 * refund path has usually got there first); partial refunds are piece 4. */
const recordRefund = (event: PaymentWebhookEvent) =>
  Effect.gen(function* () {
    if (event.paymentReference === null) return 'no payment intent on the charge';
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;
    const row = yield* paymentRepo.findByProviderReference(
      payments.provider,
      event.paymentReference
    );
    if (row === null) return 'unknown payment';
    const fetched = yield* payments.getPayment(event.paymentReference);
    const mismatch = mismatchReason(row, fetched);
    if (mismatch !== null) return `ignored: ${mismatch}`;
    if (fetched.refundedCents < row.totalCents) return 'partial refund — left for dispute handling';
    const refunded = yield* paymentRepo.advance(row.id, {
      from: ['captured', 'authorised'],
      set: { status: 'refunded', refundedAt: new Date() }
    });
    return refunded === null ? 'already refunded' : 'refunded';
  });

/** A card dispute opened. Flagged on the payment for an administrator;
 * handling disputes is piece 4. */
const flagDispute = (event: PaymentWebhookEvent) =>
  Effect.gen(function* () {
    if (event.paymentReference === null) return 'no payment intent on the dispute';
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;
    const row = yield* paymentRepo.findByProviderReference(
      payments.provider,
      event.paymentReference
    );
    if (row === null) return 'unknown payment';
    yield* paymentRepo.update(row.id, { lastError: 'card dispute opened' });
    return 'dispute flagged';
  });

/** Applies one verified event. Returns a short note for the log. */
export const processStripeEvent = (event: PaymentWebhookEvent) =>
  Effect.gen(function* () {
    if (paymentIntentEvents.has(event.type)) {
      const result = yield* settlePaymentByReference(event.objectId);
      return `settle: ${result.outcome}`;
    }
    switch (event.type) {
      case 'setup_intent.succeeded': {
        const result = yield* applyCardSetup(event.objectId, null);
        return `card setup: ${result.outcome}`;
      }
      case 'charge.refunded':
        return yield* recordRefund(event);
      case 'charge.dispute.created':
        return yield* flagDispute(event);
      case 'account.updated':
        // Connected accounts arrive with piece 2b (helper payout accounts).
        return 'account.updated: not handled yet';
      default:
        return 'ignored';
    }
  });

export type StripeWebhookResponse = {
  status: 200 | 400 | 413 | 500;
  body: { received: true; duplicate?: true } | { error: string };
};

/** The whole delivery, as a program the route runs and the tests drive. */
export const stripeWebhookProgram = (rawBody: string, signature: string | null) =>
  Effect.gen(function* () {
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return { status: 413, body: { error: 'payload too large' } } as StripeWebhookResponse;
    }
    const payments = yield* Payments;
    const events = yield* StripeWebhookEventRepo;

    const verified = yield* payments.verifyWebhook(rawBody, signature).pipe(Effect.either);
    if (verified._tag === 'Left') {
      yield* Effect.logWarning(`[stripe:webhook] refused: ${verified.left.reason}`);
      // Deliberately terse: a verbose reason here is a signing oracle.
      return { status: 400, body: { error: 'invalid signature' } } as StripeWebhookResponse;
    }
    const event = verified.right;

    const seen = yield* events.record({
      eventId: event.eventId,
      type: event.type,
      objectId: event.objectId
    });
    if (seen === 'processed') {
      return { status: 200, body: { received: true, duplicate: true } } as StripeWebhookResponse;
    }

    const processed = yield* processStripeEvent(event).pipe(Effect.exit);
    if (Exit.isFailure(processed)) {
      const reason = Cause.pretty(processed.cause);
      yield* events.markFailed(event.eventId, reason);
      yield* Effect.logError(`[stripe:webhook] ${event.eventId} ${event.type} failed`, reason);
      // 5xx: Stripe retries, and the next delivery reprocesses the event.
      return { status: 500, body: { error: 'processing failed' } } as StripeWebhookResponse;
    }
    yield* events.markProcessed(event.eventId);
    yield* Effect.logInfo(`[stripe:webhook] ${event.eventId} ${event.type}: ${processed.value}`);
    return { status: 200, body: { received: true } } as StripeWebhookResponse;
  });

const handle = async (c: HonoContext<BaseAppEnv>) => {
  // The raw text, unparsed: the signature covers these exact bytes.
  const raw = await c.req.text();
  const exit = await c
    .get('runtime')
    .runPromiseExit(stripeWebhookProgram(raw, c.req.header('stripe-signature') ?? null));
  if (Exit.isFailure(exit)) {
    // The event log itself is unreachable: let Stripe retry.
    console.error('[stripe:webhook] could not record the delivery', Cause.pretty(exit.cause));
    return c.json({ error: 'processing failed' }, 500);
  }
  return c.json(exit.value.body, exit.value.status);
};

export const stripeWebhookRoute = new Hono<BaseAppEnv>().post(
  '/',
  // Stops reading a request body (declared via Content-Length, or streamed
  // with none — Transfer-Encoding: chunked) once it exceeds the limit,
  // instead of buffering the whole thing first and checking afterwards.
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: 'payload too large' }, 413)
  }),
  handle
);
