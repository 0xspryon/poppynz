import { makeIdleContractBillingLayer } from '@repo/billing';
import {
  ContractRepo,
  dummyContract,
  dummyContractBilling,
  makeInMemoryBillingCustomerRepo,
  makeInMemoryContractBillingRepo,
  makeInMemoryPaymentRepo,
  makeInMemorySessionMoneyRepo,
  makeSessionRepoTest,
  makeUserRepoTest,
  type Payment,
  type Session,
  type SessionRefund,
  type User
} from '@repo/db';
import { makeMockPayments, Payments } from '@repo/payments';
import { Cause, Context, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { getBillingRouteProgram } from './billing.handler';
import { refundReceiptRouteProgram } from './refunds';

/** Tier 3 step 2: session refunds in the family's Billing, and receipts. */
const REFUND_ID = '0198a3b0-0000-7000-8000-0000000000f1';
const SESSION_ID = '0198a3b0-0000-7000-8000-0000000000e1';
const family = { id: 'family-1', name: 'Fam', email: 'f@example.test', role: 'family' } as User;

const hst = {
  supplyType: 'family_service_fee',
  jurisdiction: 'ON',
  component: 'hst',
  rateMillipercent: 13000,
  baseCents: 312,
  taxCents: 40,
  label: 'HST (ON) 13%',
  registrationNumber: '123456789RT0001'
};

const refund = (overrides: Partial<SessionRefund> = {}): SessionRefund => ({
  id: REFUND_ID,
  refundKey: 'res-1:family_late:0',
  sessionId: SESSION_ID,
  resolutionId: 'res-1',
  cycleId: 'cycle-1',
  contractId: 'contract-1',
  paymentId: 'payment-1',
  careCents: 4687,
  careTaxLines: [],
  careTaxCents: 0,
  feeCents: 312,
  feeTaxLines: [hst],
  feeTaxCents: 40,
  totalCents: 5039,
  commissionCents: 937,
  commissionTaxLines: [],
  status: 'succeeded',
  attempts: 1,
  providerReference: 're_1',
  failureReason: null,
  noticesSent: [],
  refundedAt: new Date('2026-11-04T09:00:00.000Z'),
  resolvedByUserId: null,
  resolvedNote: null,
  createdAt: new Date('2026-11-04T08:00:00.000Z'),
  updatedAt: new Date('2026-11-04T09:00:00.000Z'),
  ...overrides
});

const makeLayer = (options: { viewer?: string; hasPermission?: boolean } = {}) => {
  const viewer = options.viewer ?? 'family-1';
  const billing = makeInMemoryContractBillingRepo({ billing: [dummyContractBilling()] });
  billing.state.sessions.push({
    id: SESSION_ID,
    contractId: 'contract-1',
    cycleId: 'cycle-1',
    date: '2026-11-04',
    slot: 'svc-1@930',
    serviceId: 'svc-1',
    serviceName: 'Childcare',
    startMinutes: 930,
    endMinutes: 1080,
    startsAt: new Date('2026-11-04T20:30:00.000Z'),
    endsAt: new Date('2026-11-04T23:00:00.000Z'),
    elapsedMinutes: 150,
    rateCents: 2500,
    valueCents: 6250,
    status: 'cancelled',
    compensationCents: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const money = makeInMemorySessionMoneyRepo({ billing: billing.state });
  money.state.refunds.push(refund());
  const payments = makeInMemoryPaymentRepo([
    {
      id: 'payment-1',
      userId: 'family-1',
      kind: 'contract_cycle',
      status: 'captured',
      provider: 'mock',
      providerReference: 'mock_pi_1',
      totalCents: 13206,
      capturedCents: 13206,
      currency: 'CAD',
      description: 'Care with Maria T. · Mon, Nov 2 – Wed, Nov 4',
      taxLines: [],
      createdAt: new Date('2026-11-01T05:00:00.000Z'),
      capturedAt: new Date('2026-11-02T12:00:00.000Z')
    } as unknown as Payment
  ]);
  return Layer.mergeAll(
    makeIdleContractBillingLayer(),
    Layer.succeed(Payments, makeMockPayments()),
    makeInMemoryBillingCustomerRepo([]).layer,
    billing.layer,
    money.layer,
    payments.layer,
    Layer.succeed(ContractRepo, {
      findById: () =>
        Effect.succeed({
          ...dummyContract,
          id: 'contract-1',
          familyUserId: 'family-1',
          providerUserId: 'helper-1'
        })
    } as unknown as Context.Tag.Service<typeof ContractRepo>),
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: viewer }, session: { id: 'session-1' } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeUserRepoTest({
      findById: (id) =>
        Effect.succeed({ ...family, id, name: id === 'helper-1' ? 'Maria Tester' : 'Fam' }),
      findByEmail: () => Effect.succeed(family)
    }),
    makeSessionRepoTest({
      findById: () => Effect.succeed({ id: 'session-1', userId: viewer } as Session)
    })
  );
};

const receipt = (layer: ReturnType<typeof makeLayer>) =>
  Effect.runPromiseExit(
    refundReceiptRouteProgram(
      { req: { param: () => REFUND_ID } } as unknown as HonoContext<HonoEnv>,
      new Headers()
    ).pipe(Effect.provide(layer))
  );

const failureTag = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const failure = Cause.failureOption(exit.cause);
  return Option.isSome(failure) ? (failure.value as { _tag: string })._tag : null;
};

describe('session refunds in Billing', () => {
  it('lists each refund under its cycle’s charge with the session’s date and service', async () => {
    const result = await Effect.runPromise(
      getBillingRouteProgram(new Headers()).pipe(Effect.provide(makeLayer()))
    );
    expect(result.payments[0]!.refunds).toEqual([
      {
        id: REFUND_ID,
        status: 'succeeded',
        totalCents: 5039,
        createdAt: '2026-11-04T08:00:00.000Z',
        refundedAt: '2026-11-04T09:00:00.000Z',
        sessionDate: '2026-11-04',
        serviceName: 'Childcare'
      }
    ]);
  });

  it('gives the family a receipt listing the tax returned and the original charge', async () => {
    const exit = await receipt(makeLayer());
    if (!Exit.isSuccess(exit)) throw new Error('expected success');
    expect(exit.value.receipt).toMatchObject({
      id: REFUND_ID,
      totalCents: 5039,
      careCents: 4687,
      feeCents: 312,
      taxCents: 40,
      taxLines: [{ label: 'HST (ON) 13%', taxCents: 40, registrationNumber: '123456789RT0001' }],
      session: { date: '2026-11-04', serviceName: 'Childcare' },
      charge: { id: 'payment-1', totalCents: 13206 },
      helperName: expect.any(String)
    });
    expect(exit.value.receipt.number).toMatch(/^CN-[0-9A-F]{10}$/);
  });

  it('is not found for anyone but the family who paid', async () => {
    expect(failureTag(await receipt(makeLayer({ viewer: 'helper-1' })))).toBe(
      'RefundNotFoundError'
    );
  });

  it('needs the billing read permission', async () => {
    expect(failureTag(await receipt(makeLayer({ hasPermission: false })))).toBe('ForbiddenError');
  });
});
