/**
 * TEST SUPPORT: a contract-billing world with in-memory repos and the mock
 * provider on a simulated clock (the engine's suites and Tier 3 step 2's
 * session-money suites share it).
 */
import {
  ContractBillingRepo,
  ContractRepo,
  dummyBillingCustomer,
  dummyContract,
  dummyContractBilling,
  dummyContractVersion,
  dummyPayoutAccount,
  makeInMemoryBillingCustomerRepo,
  makeInMemoryContractBillingRepo,
  makeInMemoryExtraSessionRepo,
  makeInMemoryPaymentRepo,
  makeInMemoryPayoutAccountRepo,
  makeInMemorySessionMoneyRepo,
  makeInMemorySessionResolutionRepo,
  makeInMemoryCardDisputeRepo,
  makeContractAgreementRepoTest,
  dummyContractAgreementSignature,
  type ConversationMessage,
  makeSeededTaxConfigRepo,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  PaymentRepo,
  type Contract,
  type ContractBilling,
  type ContractVersion,
  type SessionResolution,
  type User
} from '@repo/db';
import { makeMailerTest, type ContractBillingNoticeMail } from '@repo/mail';
import { NoopNotificationHubTest } from '@repo/notify';
import { makeMockPayments, Payments, type MockPayments } from '@repo/payments';
import { Context, Effect, Layer } from 'effect';
import { retryFamilyBilling, runContractBilling, startContractBilling } from './engine';

// The contract: an Ontario family and a Manitoba helper, starting Monday
// 2 November 2026 in Toronto, Mon & Wed 15:30–18:00 at $25/h. Cycle 1 is
// Mon 2 – Wed 4 Nov: two 2.5 h sessions = $125.00 of service.
//   fee 5% $6.25 + HST (ON) 13% $0.81 → family pays $132.06
//   commission 15% $18.75 + GST (MB) 5% $0.94 → helper gets $105.31
export const CYCLE_1 = {
  // CONTRACT_HOLD_LEAD_HOURS (24) real hours before the start: the fall-back
  // night (1 Nov) is in between, so it reads 01:00 EDT on the wall clock.
  holdAt: new Date('2026-11-01T05:00:00.000Z'), // Sun 1 Nov 01:00 EDT
  startsAt: new Date('2026-11-02T05:00:00.000Z'), // Mon 2 Nov 00:00 EST
  captureAt: new Date('2026-11-02T12:00:00.000Z') // Mon 07:00 EST
};
export const FAMILY_TOTAL = 13206;

export const contract = (overrides: Partial<Contract> = {}): Contract => ({
  ...dummyContract,
  id: 'contract-1',
  familyUserId: 'family-1',
  providerUserId: 'helper-1',
  status: 'active',
  ...overrides
});

export const accepted = (overrides: Partial<ContractVersion> = {}): ContractVersion => ({
  ...dummyContractVersion,
  id: 'version-1',
  status: 'accepted',
  services: [
    {
      serviceId: 'svc-1',
      name: 'Childcare',
      listedRateCents: 2500,
      rateCents: 2500,
      currency: 'CAD',
      sessions: [
        { weekday: 0, startMinutes: 930, endMinutes: 1080 },
        { weekday: 2, startMinutes: 930, endMinutes: 1080 }
      ],
      expectations: ''
    }
  ],
  startsOn: '2026-11-02',
  timeZone: 'America/Toronto',
  ...overrides
});

const user = (id: string, name: string): User =>
  ({ id, name, email: `${id}@example.test`, role: 'family' }) as unknown as User;

export const readyAccount = () =>
  dummyPayoutAccount({
    userId: 'helper-1',
    provider: 'mock',
    accountReference: 'mock_acct_helper-1',
    status: 'ready',
    detailsSubmitted: true,
    payoutsEnabled: true,
    transfersActive: true,
    refreshedAt: new Date()
  });

export type WorldOptions = {
  billing?: Partial<ContractBilling>;
  helperReady?: boolean;
  card?: string | null;
  providerDown?: boolean;
  version?: Partial<ContractVersion>;
  contract?: Partial<Contract>;
  /** Overrides on the mock provider (e.g. a re-fetch that says canceled),
   * or a function of the world's own mock (whose clock is the world's). */
  payments?:
    | Partial<Context.Tag.Service<typeof Payments>>
    | ((mock: MockPayments) => Partial<Context.Tag.Service<typeof Payments>>);
  /** Options of the world's own mock provider. */
  mock?: Omit<NonNullable<Parameters<typeof makeMockPayments>[0]>, 'now' | 'providerDown'>;
  /** Wraps the in-memory payment repo (e.g. to interleave two callers). */
  paymentRepo?: (
    service: Context.Tag.Service<typeof PaymentRepo>
  ) => Context.Tag.Service<typeof PaymentRepo>;
  /** Session resolutions on file (Tier 3). */
  resolutions?: ReadonlyArray<SessionResolution>;
  /** The contract's messages (Tier 3: dispute queues, evidence). */
  messages?: ReadonlyArray<ConversationMessage>;
};

export const makeWorld = (options: WorldOptions = {}) => {
  const billingRepo = makeInMemoryContractBillingRepo({
    billing: [
      dummyContractBilling({
        status: 'scheduled',
        billableFrom: new Date('2026-10-20T00:00:00.000Z'),
        acceptedVersionId: 'version-1',
        ...options.billing
      })
    ],
    families: { 'contract-1': 'family-1' }
  });
  // The provider's clock is the step's: what it remembers (idempotency keys,
  // its search index) and how old an attempt is age with the simulated
  // time, not the wall clock.
  let clock = new Date('2026-10-24T00:00:00.000Z');
  const paymentRepo = makeInMemoryPaymentRepo([], () => clock);
  const customers = makeInMemoryBillingCustomerRepo(
    options.card === null
      ? []
      : [
          dummyBillingCustomer({
            userId: 'family-1',
            provider: 'mock',
            customerReference: 'mock_cus_family-1',
            cardReference: options.card ?? 'mock_pm_ok',
            cardBrand: 'visa',
            cardLast4: '4242',
            cardExpMonth: 12,
            cardExpYear: 2034
          })
        ]
  );
  const payouts = makeInMemoryPayoutAccountRepo(
    options.helperReady === false ? [] : [readyAccount()]
  );
  let currentContract = contract(options.contract);
  const ended: Array<string> = [];
  const mails: Array<ContractBillingNoticeMail> = [];
  const alerts: Array<string> = [];
  const mock = makeMockPayments({
    ...options.mock,
    providerDown: options.providerDown,
    now: () => clock
  });
  const overrides =
    typeof options.payments === 'function' ? options.payments(mock) : options.payments;
  const payments = { ...mock, ...overrides };
  const version = accepted(options.version);
  const resolutionRepo = makeInMemorySessionResolutionRepo({
    resolutions: [...(options.resolutions ?? [])],
    ...(options.messages ? { messages: options.messages } : {})
  });
  // Tier 3 step 4: card disputes share the billing and money state (charges,
  // ledger, recoveries, audit), as the database does.
  const cardDisputeRepo = makeInMemoryCardDisputeRepo({
    billing: billingRepo.state,
    money: () => moneyRepo.state,
    clock: () => clock
  });
  const moneyRepo = makeInMemorySessionMoneyRepo({
    // Tier 3 step 4: card disputes hold pay.
    cardDisputes: () => cardDisputeRepo.sessionCardDisputes(),
    billing: billingRepo.state,
    capturedOf: (paymentId) => paymentRepo.rows.get(paymentId)?.capturedCents ?? null,
    helpers: { 'contract-1': 'helper-1' },
    clock: () => clock
  });

  // Tier 3 step 3: extra sessions share the billing state (sessions,
  // charges, ledger), as the database does.
  const extraRepo = makeInMemoryExtraSessionRepo({
    billing: billingRepo.state,
    clock: () => clock
  });

  const layer = Layer.mergeAll(
    billingRepo.layer,
    options.paymentRepo
      ? Layer.succeed(PaymentRepo, options.paymentRepo(paymentRepo.service))
      : paymentRepo.layer,
    customers.layer,
    payouts.layer,
    makeSeededTaxConfigRepo().layer,
    cardDisputeRepo.layer,
    makeContractAgreementRepoTest({
      listForContract: () =>
        Effect.succeed([
          dummyContractAgreementSignature({
            contractVersionId: 'version-1',
            content: 'Service agreement\nCancelling at least 24 hours before a session is free.',
            contentSha256: 'a'.repeat(64),
            cancellationPolicyVersion: 3
          })
        ])
    }),
    Layer.succeed(Payments, payments),
    Layer.succeed(ContractRepo, {
      findById: () => Effect.sync(() => currentContract),
      listVersions: () => Effect.succeed([version]),
      endForBilling: (_id: string, note: string) =>
        Effect.sync(() => {
          ended.push(note);
          currentContract = { ...currentContract, status: 'ended', endNote: note };
          return currentContract;
        })
    } as unknown as Context.Tag.Service<typeof ContractRepo>),
    makeUserRepoTest({
      findById: (id) =>
        Effect.succeed(id === 'family-1' ? user(id, 'Fam Ily') : user(id, 'Sam Taylor')),
      findByEmail: () => Effect.die('unused')
    }),
    makeUserProfileRepoTest({
      create: () => Effect.die('unused'),
      findByUserId: (userId) =>
        Effect.succeed({
          userId,
          firstName: userId === 'family-1' ? 'Fam' : 'Sam',
          lastName: userId === 'family-1' ? 'Ily' : 'Taylor'
        } as never),
      updateByUserId: () => Effect.die('unused'),
      updateLocationByUserId: () => Effect.die('unused')
    }),
    makeMailerTest({
      sendContractBillingNotice: (mail) => Effect.sync(() => void mails.push(mail)),
      sendAdminBillingAlert: (mail) => Effect.sync(() => void alerts.push(mail.subject))
    }),
    NoopNotificationHubTest,
    resolutionRepo.layer,
    moneyRepo.layer,
    extraRepo.layer
  );

  const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);
  const step = (now: Date) => {
    clock = now;
    return run(runContractBilling('contract-1', now).pipe(Effect.provide(layer)));
  };
  const start = (now: Date) => {
    clock = now;
    return run(startContractBilling('contract-1', now).pipe(Effect.provide(layer)));
  };
  const retry = (now: Date) => {
    clock = now;
    return run(retryFamilyBilling('family-1', now).pipe(Effect.provide(layer)));
  };
  const cycles = () =>
    run(
      ContractBillingRepo.pipe(
        Effect.flatMap((repo) => repo.listCycles('contract-1')),
        Effect.provide(layer)
      )
    );
  const billing = () => billingRepo.state.billing.get('contract-1')!;
  const sessions = () => billingRepo.state.sessions;
  const setCard = (reference: string) =>
    customers.rows.set('family-1', {
      ...customers.rows.get('family-1')!,
      cardReference: reference
    });
  const mailTo = (prefix: string) =>
    mails.filter((mail) => mail.email.startsWith(prefix)).map((mail) => mail.subject);

  return {
    layer,
    run,
    step,
    start,
    retry,
    mock,
    cycles,
    billing,
    sessions,
    setCard,
    mails,
    mailTo,
    alerts,
    ended,
    payments: paymentRepo.rows,
    billingState: billingRepo.state,
    payouts,
    cardDisputes: cardDisputeRepo,
    resolutions: resolutionRepo,
    money: moneyRepo,
    extras: extraRepo,
    customers,
    setClock: (now: Date) => {
      clock = now;
    }
  };
};

export const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000);
