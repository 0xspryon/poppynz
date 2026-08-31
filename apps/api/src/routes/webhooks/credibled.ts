import {
  canApplyCredibledTransition,
  credibledStatusToSafetyVerificationStatus,
  verifyCredibledSignature,
  type CredibledAudience
} from '@repo/credibled';
import { SafetyVerificationRepo } from '@repo/db';
import { credibledConfig, safetyVerificationConfig } from '@repo/env';
import { Effect, Option, Redacted } from 'effect';
import { Hono } from 'hono';
import type { BaseAppEnv, HonoContext } from '@/api/app-env';
import { expiryFromCompletion, toDateOnly } from '@/api/lib/safety-verification';

/**
 * Credibled status webhooks.
 *
 * Mounted OUTSIDE the authenticated app router on purpose: this is public
 * ingress with no session, so every guarantee has to come from the signature
 * and from how the handler applies what it receives.
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

type CredibledWebhookPayload = {
  uuid?: unknown;
  data_type?: unknown;
  application_status?: unknown;
};

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
 * Applies one delivery to one record.
 *
 * Returns a short reason string for logging. Every non-applied outcome is
 * still a 2xx: a duplicate, an out-of-order event or an unknown check id are
 * all "nothing further for Credibled to do", and asking them to retry would
 * achieve nothing since they never do.
 */
const applyWebhook = (audience: CredibledAudience, payload: CredibledWebhookPayload) =>
  Effect.gen(function*() {
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

    const repo = yield* SafetyVerificationRepo;
    const record = yield* repo.findByCredibledUuid(uuid);

    if (!record) {
      // Not ours — a check placed from the Credibled dashboard, or one whose
      // record was deleted. Nothing to do, and nothing Credibled can fix.
      return 'ignored: no matching verification';
    }

    // The audience is derived from which endpoint was called, and each
    // endpoint verifies with its own account's secret. A record belonging to
    // the other role therefore means a valid signature from the wrong account
    // — refuse rather than cross the boundary.
    const expectedAudience: CredibledAudience =
      record.role === 'family' ? 'family' : 'service-provider';
    if (expectedAudience !== audience) {
      return 'ignored: audience mismatch';
    }

    const next = credibledStatusToSafetyVerificationStatus(applicationStatus);
    if (!canApplyCredibledTransition(record.status, next)) {
      // Out-of-order or duplicate delivery. Credibled sends no timestamp, so
      // this rank check IS the replay defence.
      return `ignored: ${record.status} -> ${next} is not a forward transition`;
    }

    const months = yield* validityMonths;
    const completed = applicationStatus === 'Complete';

    yield* repo.update(record.id, {
      status: next,
      // A completed check dates from now; the applicant is not verified yet —
      // an admin still decides — but the validity window is measured from
      // completion, not from the decision, so a slow review doesn't extend it.
      issuedOn: completed ? toDateOnly(new Date()) : record.issuedOn,
      expiresOn: completed ? expiryFromCompletion(new Date(), months) : record.expiresOn,
      lastOrderError: null
    });

    return `applied: ${record.status} -> ${next}`;
  });

const handle = (audience: CredibledAudience) => async (c: HonoContext<BaseAppEnv>) => {
  const runtime = c.get('runtime');

  const declaredLength = Number.parseInt(c.req.header('content-length') ?? '0', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return c.json({ error: 'payload too large' }, 413);
  }

  const raw = await c.req.text();
  // String length counts UTF-16 units, which under-counts multibyte payloads.
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return c.json({ error: 'payload too large' }, 413);
  }

  let payload: CredibledWebhookPayload;
  try {
    payload = JSON.parse(raw) as CredibledWebhookPayload;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return c.json({ error: 'invalid json' }, 400);
  }

  const secret = await runtime.runPromise(secretFor());
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
      return c.json({ error: 'webhook not configured' }, 503);
    }
  }

  // A configured secret is always enforced — the bypass only covers the case
  // where there is no secret at all, so setting the flag in an environment
  // that HAS one changes nothing.
  if (secret && !verifyCredibledSignature(payload, c.req.header('X-HMAC-Signature'), secret)) {
    // Deliberately terse: a verbose reason here is a signing oracle.
    return c.json({ error: 'invalid signature' }, 401);
  }

  try {
    const outcome = await runtime.runPromise(applyWebhook(audience, payload));
    console.log(`[credibled:webhook:${audience}] ${outcome}`);
    return c.json({ received: true }, 200);
  } catch (error) {
    // A database failure is the one case worth a 5xx. Credibled won't retry,
    // but the reconcile poller will pick the check up on its next pass.
    console.error(`[credibled:webhook:${audience}] failed to apply delivery`, error);
    return c.json({ error: 'processing failed' }, 500);
  }
};

export const credibledWebhookRoute = new Hono<BaseAppEnv>()
  .post('/service-provider', handle('service-provider'))
  .post('/family', handle('family'));
