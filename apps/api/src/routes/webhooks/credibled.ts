import {
  canApplyCredibledTransition,
  credibledOutcomeFromWebhook,
  credibledStatusToCheckOrderStatus,
  verifyCredibledSignature,
  type CredibledAudience,
  type CredibledWebhookResultFields
} from '@repo/credibled';
import { CheckOrderRepo, inFlightCheckOrderStatuses } from '@repo/db';
import { credibledConfig, safetyVerificationConfig } from '@repo/env';
import { Effect, Option, Redacted } from 'effect';
import { Hono } from 'hono';
import type { BaseAppEnv, HonoContext } from '@/api/app-env';
import { expiryFromCompletion, toDateOnly } from '@/api/lib/safety-verification';
import {
  logCredibledWebhookRequest,
  recordCredibledWebhookOutcome,
  recordCredibledWebhookSignature
} from './credibled-webhook-log';
import { publishNotificationBestEffort } from '@repo/notify';

/**
 * Credibled status webhooks.
 *
 * Mounted OUTSIDE the authenticated app router on purpose: this is public
 * ingress with no session, so every guarantee has to come from the signature
 * and from how the handler applies what it receives.
 *
 * TEMPORARY, FOR THE STAGING VERIFICATION RUN ONLY: signature enforcement is
 * commented out below and every delivery is recorded verbatim to
 * `app_db.credibled_webhook_log` (migration 0018). A Canadian tester drives
 * the one real check we get, and neither a misconfigured secret nor a signing
 * scheme that differs from ours may cause us to discard it. Restore the
 * enforcement block, un-skip the signature tests in the e2e suite, drop the
 * table and delete the logging before this reaches production.
 *
 * Three properties of Credibled's design shape this file:
 *
 *   1. The signature covers the PARSED payload re-serialised Python-style, not
 *      the raw bytes — so we parse first, then verify (see @repo/credibled).
 *   2. There is no timestamp header, so a replay window cannot be enforced.
 *      Replay safety comes entirely from applying transitions idempotently and
 *      only ever forwards.
 *   3. A failed delivery is logged by Credibled and never retried. We
 *      therefore return 2xx for anything we have durably handled or knowingly
 *      ignored, and reserve 5xx for "try the reconcile poller instead".
 *
 * Each Credibled account has its own webhook secret and the payload identifies
 * neither the account nor the audience, so the audience comes from the path —
 * one registered endpoint per Credibled dashboard.
 */

/** Credibled payloads are small; anything large is not one of theirs. */
const MAX_BODY_BYTES = 64 * 1024;

type CredibledWebhookPayload = CredibledWebhookResultFields & {
  uuid?: unknown;
  data_type?: unknown;
  /** Credibled-hosted applicant link, preferred over the raw Certn one —
   * the same preference createBackgroundCheck applies. */
  cred_application_url?: unknown;
  application_url?: unknown;
};

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const secretFor = () =>
  credibledConfig.pipe(
    Effect.map((config) => {
      const option = config.providerWebhookSecret;
      return Option.match(option, {
        onNone: () => null,
        onSome: (secret) => {
          const raw = Redacted.value(secret).trim();
          return raw.length > 0 ? raw : null;
        }
      });
    }),
    Effect.orElseSucceed(() => null)
  );

const validityMonths = safetyVerificationConfig.pipe(
  Effect.map((policy) => policy.validityMonths),
  Effect.orElseSucceed(() => 12)
);

/**
 * Applies one delivery to one order.
 *
 * Returns a short reason string for logging. Every non-applied outcome is
 * still a 2xx: a duplicate, an out-of-order event or an unknown check id are
 * all "nothing further for Credibled to do", and asking them to retry would
 * achieve nothing since they never do.
 *
 * A delivery moves the ORDER. Completing an order is what creates the safety
 * verdict — in review_required, never verified — and the two writes happen in
 * one transaction inside the repository so a webhook can never leave an order
 * closed with no verdict behind it.
 *
 * Success and failure both land in review. What differs is what is recorded
 * alongside: Credibled's overall and per-check scores, classified as cleared,
 * not_cleared or inconclusive, so the administrator sees the result without
 * opening the report and an adverse one heads the queue.
 */
const applyWebhook = (audience: CredibledAudience, payload: CredibledWebhookPayload) =>
  Effect.gen(function* () {
    const uuid = typeof payload.uuid === 'string' ? payload.uuid : null;
    const applicationStatus =
      typeof payload.application_status === 'string' ? payload.application_status : null;

    if (!uuid || !applicationStatus) {
      return 'ignored: malformed payload';
    }
    // Reference checks share the endpoint; we only order background checks.
    if (typeof payload.data_type === 'string' && payload.data_type !== 'background_check') {
      return `ignored: data_type ${payload.data_type}`;
    }

    const orders = yield* CheckOrderRepo;
    const order = yield* orders.findByCredibledUuid(uuid);

    if (!order) {
      // Not ours — a check placed from the Credibled dashboard, or one whose
      // order was deleted. Nothing to do, and nothing Credibled can fix.
      return 'ignored: no matching order';
    }

    // The audience is derived from which endpoint was called, and each
    // endpoint verifies with its own account's secret. An order belonging to
    // the other role therefore means a valid signature from the wrong account
    // — refuse rather than cross the boundary.
    const expectedAudience: CredibledAudience =
      order.role === 'family' ? 'family' : 'service-provider';
    if (expectedAudience !== audience) {
      return 'ignored: audience mismatch';
    }

    const next = credibledStatusToCheckOrderStatus(applicationStatus);
    if (!canApplyCredibledTransition(order.status, next)) {
      // Out-of-order or duplicate delivery. Credibled sends no timestamp, so
      // this rank check IS the replay defence.
      return `ignored: ${order.status} -> ${next} is not a forward transition`;
    }

    // Placing the order does not always yield a link (adopting a duplicate
    // check returns none), but every delivery carries one. Fill the gap so
    // "Continue your check" appears; never overwrite a link we already show.
    const applicationUrl =
      order.applicationUrl === null
        ? (nonEmptyString(payload.cred_application_url) ?? nonEmptyString(payload.application_url))
        : null;

    if (next === 'complete') {
      const months = yield* validityMonths;
      const now = new Date();
      // Only a genuine Complete carries dates. Action Required and In Dispute
      // still need a person, but there is nothing finished to measure a
      // validity window from — the administrator's decision supplies one.
      const completed = applicationStatus === 'Complete';
      // A completed check dates from now; the applicant is not verified yet —
      // an admin still decides — but the validity window is measured from
      // completion, not from the decision, so a slow review doesn't extend it.
      const outcome = credibledOutcomeFromWebhook(payload);
      const result = yield* orders.complete(order.id, {
        completedAt: now,
        result: outcome,
        verification: {
          consentAt: order.consentAt,
          consentPolicyVersion: order.consentPolicyVersion,
          issuedOn: completed ? toDateOnly(now) : null,
          expiresOn: completed ? expiryFromCompletion(now, months) : null
        }
      });
      if (!result) {
        return `ignored: ${order.status} -> complete was applied concurrently`;
      }
      yield* publishNotificationBestEffort(order.userId, {
        type: 'safety_verification.updated',
        payload: { status: 'review_required' }
      });
      return `applied: ${order.status} -> complete, ${outcome.outcome} (verification ${result.verification.id} awaiting review)`;
    }

    // Guarded like completion is: the rank check ran on the row as read, and
    // the poller may have completed the order since. An unguarded write here
    // would drag a completed order back in flight.
    const advanced = yield* orders.advance(order.id, {
      from: { status: inFlightCheckOrderStatuses },
      set: {
        status: next,
        lastOrderError: null,
        ...(applicationUrl ? { applicationUrl } : {})
      }
    });

    if (!advanced) {
      return `ignored: ${order.status} -> ${next} was overtaken by a concurrent transition`;
    }
    if (next === 'invited' || next === 'in_progress') {
      yield* publishNotificationBestEffort(order.userId, {
        type: 'safety_verification.updated',
        payload: { status: next }
      });
    }
    return `applied: ${order.status} -> ${next}`;
  });

const handle = (audience: CredibledAudience) => async (c: HonoContext<BaseAppEnv>) => {
  const runtime = c.get('runtime');

  const declaredLength = Number.parseInt(c.req.header('content-length') ?? '0', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    // Refused without buffering the body, so the log gets headers only.
    const oversized = await logCredibledWebhookRequest(c, audience, null);
    await recordCredibledWebhookOutcome(oversized, 413, 'rejected: declared payload too large');
    return c.json({ error: 'payload too large' }, 413);
  }

  const raw = await c.req.text();
  // TEMPORARY: recorded here, ahead of every check below, so that a delivery
  // rejected for a bad signature or an unparseable body is still reviewable.
  const logId = await logCredibledWebhookRequest(c, audience, raw);

  // String length counts UTF-16 units, which under-counts multibyte payloads.
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    await recordCredibledWebhookOutcome(logId, 413, 'rejected: payload too large');
    return c.json({ error: 'payload too large' }, 413);
  }

  let payload: CredibledWebhookPayload;
  try {
    payload = JSON.parse(raw) as CredibledWebhookPayload;
  } catch {
    await recordCredibledWebhookOutcome(logId, 400, 'rejected: invalid json');
    return c.json({ error: 'invalid json' }, 400);
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    await recordCredibledWebhookOutcome(logId, 400, 'rejected: payload is not an object');
    return c.json({ error: 'invalid json' }, 400);
  }

  const secret = await runtime.runPromise(secretFor());

  // ==========================================================================
  // TEMPORARY — SIGNATURE ENFORCEMENT IS DISABLED FOR THE STAGING RUN.
  //
  // The first real delivery comes from a tester in Canada and we only get one
  // shot at it, so a wrong secret or a signing scheme that differs from what
  // @repo/credibled reproduces must not throw the payload away. The check
  // still RUNS — its verdict is recorded against the log row as
  // `signature_valid` — it simply no longer decides whether we process.
  //
  // RESTORE THE COMMENTED BLOCK BELOW AND DELETE THIS ONE BEFORE MERGING.
  // Until then this endpoint accepts unauthenticated input from anyone who
  // knows the URL: everything it can do is bounded by the forward-only
  // transition check in applyWebhook, but it must not reach production.
  // ==========================================================================
  const signatureValid = secret
    ? verifyCredibledSignature(payload, c.req.header('X-HMAC-Signature'), secret)
    : null;
  await recordCredibledWebhookSignature(
    logId,
    signatureValid,
    secret === null
      ? 'no webhook secret configured'
      : signatureValid
        ? 'signature verified'
        : 'signature MISMATCH (would have been a 401)'
  );
  if (signatureValid !== true) {
    console.warn(
      `[credibled:webhook:${audience}] processing an unverified delivery — ` +
        `${secret === null ? 'no secret configured' : 'signature mismatch'}. ` +
        'Signature enforcement is temporarily disabled for staging testing.'
    );
  }

  /* RESTORE ME — signature enforcement, disabled only for the staging run.
  if (!secret) {
    // Local development against the sandbox often has no webhook secret yet.
    // The bypass is opt-in, loud, and impossible to reach by accident: absent
    // the flag a missing secret is a deployment error, and 503 is the honest
    // answer rather than silently processing an unverifiable delivery.
    if (process.env.CREDIBLED_WEBHOOK_INSECURE === 'true') {
      console.warn(
        `[credibled:webhook:${audience}] SIGNATURE VERIFICATION BYPASSED — ` +
        'CREDIBLED_WEBHOOK_INSECURE is set. Never enable this outside local development.'
      );
    } else {
      console.error(`[credibled:webhook] no webhook secret configured for ${audience}`);
      await recordCredibledWebhookOutcome(logId, 503, 'rejected: no webhook secret configured');
      return c.json({ error: 'webhook not configured' }, 503);
    }
  }

  // A configured secret is always enforced — the bypass only covers the case
  // where there is no secret at all, so setting the flag in an environment
  // that HAS one changes nothing.
  if (secret && !verifyCredibledSignature(payload, c.req.header('X-HMAC-Signature'), secret)) {
    await recordCredibledWebhookOutcome(logId, 401, 'rejected: invalid signature');
    // Deliberately terse: a verbose reason here is a signing oracle.
    return c.json({ error: 'invalid signature' }, 401);
  }
  */

  try {
    const outcome = await runtime.runPromise(applyWebhook(audience, payload));
    console.log(`[credibled:webhook:${audience}] ${outcome}`);
    await recordCredibledWebhookOutcome(logId, 200, outcome);
    return c.json({ received: true }, 200);
  } catch (error) {
    // A database failure is the one case worth a 5xx. Credibled won't retry,
    // but the reconcile poller will pick the check up on its next pass.
    console.error(`[credibled:webhook:${audience}] failed to apply delivery`, error);
    await recordCredibledWebhookOutcome(
      logId,
      500,
      `failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return c.json({ error: 'processing failed' }, 500);
  }
};

/**
 * TEMPORARY — catches deliveries that do not match either endpoint.
 *
 * A Credibled dashboard pointed at the wrong path, or sending a method we do
 * not expect, currently 404s and tells us nothing. During the staging run we
 * would rather record the attempt and answer 2xx: Credibled never retries, so
 * a 404 is a delivery lost with no trace. Remove with the rest of the logging.
 */
const handleUnmatched = async (c: HonoContext<BaseAppEnv>) => {
  const raw = await c.req.text().catch(() => null);
  const logId = await logCredibledWebhookRequest(c, null, raw);
  console.warn(`[credibled:webhook] unmatched ${c.req.method} ${new URL(c.req.url).pathname}`);
  await recordCredibledWebhookOutcome(logId, 200, 'ignored: unmatched route');
  return c.json({ received: true }, 200);
};

export const credibledWebhookRoute = new Hono<BaseAppEnv>()
  .post('/service-provider', handle('service-provider'))
  .post('/family', handle('family'))
  // Registered last so the real endpoints above always win.
  .all('/*', handleUnmatched);
