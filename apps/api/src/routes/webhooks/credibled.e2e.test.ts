import { credibledSignature } from '@repo/credibled';
import {
  DBNotFoundError,
  makeSafetyVerificationRepoTest,
  type SafetyVerification,
  type SafetyVerificationUpdateInput
} from '@repo/db';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BaseAppEnv } from '@/api/app-env';
import { credibledWebhookRoute } from './credibled';

// Public ingress with no session — every guarantee has to come from the
// signature and from how the handler applies what it receives, so this suite
// is the security boundary for the whole integration.

const SECRET = 'dbf737da5fe6b3cee97607a76f05081b2ce7620bbe06a84753c1dc91e33c6d1b';

beforeEach(() => {
  process.env.CREDIBLED_PROVIDER_WEBHOOK_SECRET = SECRET;
  process.env.CREDIBLED_FAMILY_WEBHOOK_SECRET = SECRET;
});

const record = (overrides: Partial<SafetyVerification> = {}): SafetyVerification =>
  ({
    id: 'sv-1',
    userId: 'provider-1',
    role: 'service-provider',
    status: 'in_progress',
    route: 'credibled',
    credibledCheckUuid: 'check-1',
    credibledCheckTypeValue: 'request_enhanced_criminal_record_check',
    applicationUrl: null,
    consentAt: new Date('2026-08-01T00:00:00.000Z'),
    consentPolicyVersion: '2026-08-22',
    paymentReference: 'mock_auth_sv-1',
    refundReference: null,
    amountCents: 4500,
    feeCents: 500,
    taxCents: 0,
    totalCents: 5000,
    issuingAuthority: null,
    documentNumber: null,
    filename: null,
    fileKey: null,
    issuedOn: null,
    expiresOn: null,
    reviewedBy: null,
    reviewedAt: null,
    decisionReason: null,
    expiryNotifiedAt: null,
    orderAttempts: 1,
    lastOrderError: null,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as SafetyVerification;

const makeApp = (
  options: {
    found?: SafetyVerification | null;
    onUpdate?: (id: string, input: SafetyVerificationUpdateInput) => void;
    updateFails?: boolean;
  } = {}
) => {
  const found = options.found === undefined ? record() : options.found;
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      makeSafetyVerificationRepoTest({
        findLive: () => Effect.succeed(null),
        findById: () =>
          Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: '' })),
        findByCredibledUuid: (uuid) =>
          Effect.succeed(found && found.credibledCheckUuid === uuid ? found : null),
        listByUser: () => Effect.succeed([]),
        listForReview: () => Effect.succeed([]),
        create: () => Effect.die('not used'),
        update: (id, input) => {
          options.onUpdate?.(id, input);
          return options.updateFails
            ? Effect.die('database is down')
            : Effect.succeed(record({ ...(found ?? {}), ...input } as Partial<SafetyVerification>));
        },
        listExpiringForNotification: () => Effect.succeed([]),
        markExpiryNotified: () => Effect.die('not used'),
        listLapsed: () => Effect.succeed([]),
        listInFlight: () => Effect.succeed([]),
        listAwaitingOrder: () => Effect.succeed([])
      })
    )
  );

  return new Hono<BaseAppEnv>()
    .use('*', async (c, next) => {
      c.set('runtime', runtime as never);
      await next();
    })
    .route('/webhooks/credibled', credibledWebhookRoute);
};

const post = (
  app: ReturnType<typeof makeApp>,
  payload: unknown,
  options: { signature?: string | null; path?: string } = {}
) => {
  const body = JSON.stringify(payload);
  const signature =
    options.signature === undefined ? credibledSignature(payload, SECRET) : options.signature;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) {
    headers['X-HMAC-Signature'] = signature;
  }
  return app.request(options.path ?? '/webhooks/credibled/service-provider', {
    method: 'POST',
    headers,
    body
  });
};

const complete = { uuid: 'check-1', data_type: 'background_check', application_status: 'Complete' };

describe('credibled webhook — authenticity', () => {
  it('rejects a delivery with no signature', async () => {
    const res = await post(makeApp(), complete, { signature: null });
    expect(res.status).toBe(401);
  });

  it('rejects a forged signature', async () => {
    const res = await post(makeApp(), complete, { signature: 'a'.repeat(64) });
    expect(res.status).toBe(401);
  });

  it('rejects a signature made with a different secret', async () => {
    const res = await post(makeApp(), complete, {
      signature: credibledSignature(complete, 'b'.repeat(64))
    });
    expect(res.status).toBe(401);
  });

  it('rejects a payload tampered with after signing', async () => {
    const res = await post(
      makeApp(),
      { ...complete, application_status: 'Cancelled' },
      { signature: credibledSignature(complete, SECRET) }
    );
    expect(res.status).toBe(401);
  });

  it('refuses to process anything when no secret is configured', async () => {
    delete process.env.CREDIBLED_PROVIDER_WEBHOOK_SECRET;
    const updates: Array<string> = [];
    const res = await post(makeApp({ onUpdate: (id) => updates.push(id) }), complete);
    // 503, never a silent accept — an unverifiable delivery is not applied.
    expect(res.status).toBe(503);
    expect(updates).toHaveLength(0);
  });

  it('rejects malformed json before doing anything else', async () => {
    const app = makeApp();
    const res = await app.request('/webhooks/credibled/service-provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-HMAC-Signature': 'x'.repeat(64) },
      body: 'not json'
    });
    expect(res.status).toBe(400);
  });

  it('rejects an oversized body', async () => {
    const app = makeApp();
    const res = await app.request('/webhooks/credibled/service-provider', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(10 * 1024 * 1024)
      },
      body: JSON.stringify(complete)
    });
    expect(res.status).toBe(413);
  });
});

describe('credibled webhook — application', () => {
  it('advances a check that is genuinely progressing', async () => {
    const updates: Array<SafetyVerificationUpdateInput> = [];
    const res = await post(makeApp({ onUpdate: (_id, input) => updates.push(input) }), complete);

    expect(res.status).toBe(200);
    // Complete never means verified — a person still decides.
    expect(updates[0]?.status).toBe('review_required');
    expect(updates[0]?.expiresOn).toBeTruthy();
  });

  it('ignores a duplicate delivery', async () => {
    const updates: Array<string> = [];
    const res = await post(
      makeApp({
        found: record({ status: 'review_required' }),
        onUpdate: (id) => updates.push(id)
      }),
      complete
    );

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it('ignores a replayed earlier event that would drag the record backwards', async () => {
    // Credibled sends no timestamp, so nothing else can catch this.
    const updates: Array<string> = [];
    const res = await post(
      makeApp({ found: record({ status: 'review_required' }), onUpdate: (id) => updates.push(id) }),
      { uuid: 'check-1', data_type: 'background_check', application_status: 'In Progress' }
    );

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it('refuses to reopen a decided record', async () => {
    const updates: Array<string> = [];
    const res = await post(
      makeApp({ found: record({ status: 'rejected' }), onUpdate: (id) => updates.push(id) }),
      complete
    );

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it('will not let one audience move the other audience’s record', async () => {
    // A valid signature from the family account must not touch a helper's row.
    const updates: Array<string> = [];
    const res = await post(
      makeApp({ found: record({ role: 'service-provider' }), onUpdate: (id) => updates.push(id) }),
      complete,
      { path: '/webhooks/credibled/family' }
    );

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it('acknowledges a check it has never heard of', async () => {
    const res = await post(makeApp({ found: null }), complete);
    // Nothing to do, and Credibled never retries — so a 2xx is honest.
    expect(res.status).toBe(200);
  });

  it('ignores reference checks, which share the endpoint', async () => {
    const updates: Array<string> = [];
    const payload = {
      uuid: 'check-1',
      data_type: 'reference_check',
      application_status: 'Complete'
    };
    const res = await post(makeApp({ onUpdate: (id) => updates.push(id) }), payload);

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it('returns 5xx when the database fails, so the poller retries the check', async () => {
    const res = await post(makeApp({ updateFails: true }), complete);
    expect(res.status).toBe(500);
  });
});
