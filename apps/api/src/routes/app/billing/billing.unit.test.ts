import { makeIdleContractBillingLayer } from '@repo/billing';
import { SqlError } from '@effect/sql/SqlError';
import {
  BillingCustomerRepo,
  DBNotFoundError,
  dummyBillingCustomer,
  makeInMemoryBillingCustomerRepo,
  makePaymentRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type BillingCustomer,
  type PaymentHistoryItem,
  type Session,
  type User
} from '@repo/db';
import { makePaymentsTest, PaymentProviderError, type ProviderCardSetup } from '@repo/payments';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  confirmCardSetupRouteProgram,
  getBillingRouteProgram,
  startCardSetupRouteProgram
} from './billing.handler';

const family = {
  id: 'family-1',
  name: 'Fam Ily',
  email: 'family@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  isAnonymous: false,
  role: 'family',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null
} as User;

const session = { id: 'session-1', userId: 'family-1' } as Session;

const historyRow = (overrides: Partial<PaymentHistoryItem> = {}): PaymentHistoryItem =>
  ({
    id: 'payment-1',
    userId: 'family-1',
    kind: 'credibled_order',
    status: 'captured',
    provider: 'mock',
    providerReference: 'mock_pi_payment-1',
    totalCents: 7500,
    capturedCents: null,
    currency: 'CAD',
    taxLines: [],
    receiptUrl: 'https://pay.stripe.com/receipts/r1',
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    description: 'Background check',
    ...overrides
  }) as PaymentHistoryItem;

const contextWithJson = (body: unknown) =>
  ({ req: { json: () => Promise.resolve(body) } }) as unknown as HonoContext<HonoEnv>;

const failureTag = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const failure = Cause.failureOption(exit.cause);
  return Option.isSome(failure) ? (failure.value as { _tag: string })._tag : null;
};

const makeLayer = (
  options: {
    hasPermission?: boolean;
    billing?: Array<BillingCustomer>;
    history?: Array<PaymentHistoryItem>;
    historyFails?: boolean;
    setup?: ProviderCardSetup;
    providerDown?: boolean;
    removed?: Array<string>;
  } = {}
) => {
  const billing = makeInMemoryBillingCustomerRepo(options.billing ?? []);
  const layer = Layer.mergeAll(
    makeIdleContractBillingLayer(),
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: family.id }, session: { id: session.id } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeUserRepoTest({
      findById: (id) =>
        id === family.id
          ? Effect.succeed(family)
          : Effect.fail(new DBNotFoundError({ entity: 'user', value: id })),
      findByEmail: () => Effect.succeed(family)
    }),
    makeSessionRepoTest({ findById: () => Effect.succeed(session) }),
    billing.layer,
    makePaymentRepoTest({
      listByUser: () =>
        options.historyFails
          ? Effect.fail(new SqlError({ cause: 'down' }))
          : Effect.succeed(options.history ?? [])
    }),
    makePaymentsTest({
      startCardSetup: (customer) =>
        options.providerDown
          ? Effect.fail(new PaymentProviderError({ operation: 'startCardSetup', cause: 'down' }))
          : Effect.succeed({ reference: `seti_for_${customer}`, clientSecret: 'seti_secret' }),
      getCardSetup: (reference) =>
        Effect.succeed(
          options.setup ?? {
            reference,
            status: 'succeeded',
            customer: 'mock_cus_family-1',
            paymentMethod: {
              reference: 'mock_pm_new',
              brand: 'mastercard',
              last4: '4444',
              expMonth: 3,
              expYear: 2031
            }
          }
        ),
      removeCard: (reference) => Effect.sync(() => void options.removed?.push(reference))
    })
  );
  return { layer, billing };
};

describe('GET /billing', () => {
  it('shows the card on file and the payment history, newest first as the repo returns it', async () => {
    const { layer } = makeLayer({
      billing: [dummyBillingCustomer()],
      history: [historyRow(), historyRow({ id: 'payment-0', status: 'failed', receiptUrl: null })]
    });
    const result = await Effect.runPromise(
      getBillingRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({
      card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 },
      payments: [
        {
          id: 'payment-1',
          createdAt: '2026-10-01T10:00:00.000Z',
          description: 'Background check',
          totalCents: 7500,
          currency: 'CAD',
          taxLines: [],
          status: 'paid',
          receiptUrl: 'https://pay.stripe.com/receipts/r1'
        },
        {
          id: 'payment-0',
          createdAt: '2026-10-01T10:00:00.000Z',
          description: 'Background check',
          totalCents: 7500,
          currency: 'CAD',
          taxLines: [],
          status: 'failed',
          receiptUrl: null
        }
      ],
      provider: 'mock'
    });
  });

  it('shows no card when none is saved', async () => {
    const { layer } = makeLayer();
    const result = await Effect.runPromise(
      getBillingRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(result.card).toBeNull();
  });

  it('denies a user without the billing permission (helpers)', async () => {
    const { layer } = makeLayer({ hasPermission: false });
    const exit = await Effect.runPromiseExit(
      getBillingRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(failureTag(exit)).toBe('ForbiddenError');
  });

  it('maps a database failure to the repo error', async () => {
    const { layer } = makeLayer({ historyFails: true });
    const exit = await Effect.runPromiseExit(
      getBillingRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(failureTag(exit)).toBe('BillingRepoError');
  });
});

describe('POST /billing/card/setup', () => {
  it("creates the family's customer on first use and starts a setup for it", async () => {
    const { layer, billing } = makeLayer();
    const result = await Effect.runPromise(
      startCardSetupRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(result).toEqual({
      setupId: 'seti_for_mock_cus_family-1',
      clientSecret: 'seti_secret',
      provider: 'mock'
    });
    expect(billing.rows.get('family-1')?.customerReference).toBe('mock_cus_family-1');
  });

  it('maps an unreachable provider to the provider error', async () => {
    const { layer } = makeLayer({ providerDown: true });
    const exit = await Effect.runPromiseExit(
      startCardSetupRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(failureTag(exit)).toBe('BillingProviderError');
  });

  it('denies a user without the billing permission', async () => {
    const { layer } = makeLayer({ hasPermission: false });
    const exit = await Effect.runPromiseExit(
      startCardSetupRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(failureTag(exit)).toBe('ForbiddenError');
  });
});

describe('POST /billing/card/confirm', () => {
  const confirm = (
    layer: ReturnType<typeof makeLayer>['layer'],
    body: unknown = { setupId: 'seti_1' }
  ) =>
    Effect.runPromiseExit(
      confirmCardSetupRouteProgram(contextWithJson(body), new Headers()).pipe(Effect.provide(layer))
    );

  it('replaces the card on file and detaches the old one', async () => {
    const removed: Array<string> = [];
    const { layer, billing } = makeLayer({ billing: [dummyBillingCustomer()], removed });
    const exit = await confirm(layer);

    expect(exit).toEqual(
      Exit.succeed({ card: { brand: 'mastercard', last4: '4444', expMonth: 3, expYear: 2031 } })
    );
    expect(billing.rows.get('family-1')?.cardReference).toBe('mock_pm_new');
    expect(removed).toEqual(['mock_pm_saved']);
  });

  it('answers with the card now on file when a concurrent confirm replaced it first', async () => {
    // Read the old card, but another tab's confirm landed before our write:
    // the compare-and-set loses, nothing is detached, and the browser is
    // shown the card that really is on file.
    const removed: Array<string> = [];
    const winner = dummyBillingCustomer({
      cardReference: 'mock_pm_other_tab',
      cardBrand: 'visa',
      cardLast4: '1881',
      cardExpMonth: 7,
      cardExpYear: 2033
    });
    const { layer, billing } = makeLayer({ billing: [winner], removed });
    const inner = Effect.runSync(BillingCustomerRepo.pipe(Effect.provide(billing.layer)));
    let reads = 0;
    const staleFirstRead = Layer.succeed(BillingCustomerRepo, {
      ...inner,
      findByUserId: (userId) =>
        (reads += 1) === 1 ? Effect.succeed(dummyBillingCustomer()) : inner.findByUserId(userId)
    });
    const exit = await confirm(Layer.merge(layer, staleFirstRead));

    expect(exit).toEqual(
      Exit.succeed({ card: { brand: 'visa', last4: '1881', expMonth: 7, expYear: 2033 } })
    );
    expect(billing.rows.get('family-1')?.cardReference).toBe('mock_pm_other_tab');
    expect(removed).toEqual([]);
  });

  it("refuses a setup that belongs to another user's customer", async () => {
    const { layer } = makeLayer({
      billing: [dummyBillingCustomer()],
      setup: {
        reference: 'seti_1',
        status: 'succeeded',
        customer: 'mock_cus_someone-else',
        paymentMethod: null
      }
    });
    expect(failureTag(await confirm(layer))).toBe('BillingCardSetupNotFoundError');
  });

  it('refuses a setup the provider has not finished', async () => {
    const { layer } = makeLayer({
      billing: [dummyBillingCustomer()],
      setup: {
        reference: 'seti_1',
        status: 'requires_action',
        customer: 'mock_cus_family-1',
        paymentMethod: null
      }
    });
    expect(failureTag(await confirm(layer))).toBe('BillingCardSetupIncompleteError');
  });

  it('rejects a body without a setup id', async () => {
    const { layer } = makeLayer({ billing: [dummyBillingCustomer()] });
    expect(failureTag(await confirm(layer, {}))).toBe('RequestValidationError');
  });

  it('denies a user without the billing permission', async () => {
    const { layer } = makeLayer({ hasPermission: false });
    expect(failureTag(await confirm(layer))).toBe('ForbiddenError');
  });
});
