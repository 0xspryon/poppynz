import { describe, expect, it } from 'bun:test';
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
  makeInMemoryPaymentRepo,
  makeInMemoryPayoutAccountRepo,
  makeSeededTaxConfigRepo,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  PaymentRepo,
  type Contract,
  type ContractBilling,
  type ContractVersion,
  type User
} from '@repo/db';
import { makeMailerTest, type ContractBillingNoticeMail } from '@repo/mail';
import { NoopNotificationHubTest } from '@repo/notify';
import {
  makeMockPayments,
  PaymentProviderError,
  Payments,
  type ChargeSavedCardInput,
  type MockPayments,
  type ProviderPayment
} from '@repo/payments';
import { ConfigProvider, Context, Effect, Exit, Layer } from 'effect';
import {
  adoptProviderPayment,
  familyRetryEligible,
  previewCardResumes,
  retryContractPayment,
  retryFamilyBilling,
  runContractBilling,
  runContractBillingTick,
  startContractBilling
} from './engine';

// The contract: an Ontario family and a Manitoba helper, starting Monday
// 2 November 2026 in Toronto, Mon & Wed 15:30–18:00 at $25/h. Cycle 1 is
// Mon 2 – Wed 4 Nov: two 2.5 h sessions = $125.00 of service.
//   fee 5% $6.25 + HST (ON) 13% $0.81 → family pays $132.06
//   commission 15% $18.75 + GST (MB) 5% $0.94 → helper gets $105.31
const CYCLE_1 = {
  // CONTRACT_HOLD_LEAD_HOURS (24) real hours before the start: the fall-back
  // night (1 Nov) is in between, so it reads 01:00 EDT on the wall clock.
  holdAt: new Date('2026-11-01T05:00:00.000Z'), // Sun 1 Nov 01:00 EDT
  startsAt: new Date('2026-11-02T05:00:00.000Z'), // Mon 2 Nov 00:00 EST
  captureAt: new Date('2026-11-02T12:00:00.000Z') // Mon 07:00 EST
};
const FAMILY_TOTAL = 13206;

const contract = (overrides: Partial<Contract> = {}): Contract => ({
  ...dummyContract,
  id: 'contract-1',
  familyUserId: 'family-1',
  providerUserId: 'helper-1',
  status: 'active',
  ...overrides
});

const accepted = (overrides: Partial<ContractVersion> = {}): ContractVersion => ({
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

const readyAccount = () =>
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

type WorldOptions = {
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
};

const makeWorld = (options: WorldOptions = {}) => {
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

  const layer = Layer.mergeAll(
    billingRepo.layer,
    options.paymentRepo
      ? Layer.succeed(PaymentRepo, options.paymentRepo(paymentRepo.service))
      : paymentRepo.layer,
    customers.layer,
    payouts.layer,
    makeSeededTaxConfigRepo().layer,
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
    NoopNotificationHubTest
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
    payouts
  };
};

const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000);

describe('cycles: hold → capture', () => {
  it('materialises the 14-day window and places nothing before the hold time', async () => {
    const world = makeWorld();
    await world.step(new Date('2026-10-25T12:00:00.000Z'));
    const cycles = await world.cycles();
    expect(cycles.map((c) => [c.index, c.startsOn, c.endsOn, c.status])).toEqual([
      [0, '2026-11-02', '2026-11-04', 'scheduled'],
      [1, '2026-11-05', '2026-11-07', 'scheduled']
    ]);
    expect(cycles[0]!.holdAt).toEqual(CYCLE_1.holdAt);
    expect(cycles[0]!.captureAt).toEqual(CYCLE_1.captureAt);
    // Today Oct 25 + 13 = Nov 7: the Mon 2 and Wed 4 sessions exist.
    expect(world.sessions().map((s) => [s.date, s.elapsedMinutes, s.valueCents])).toEqual([
      ['2026-11-02', 150, 6250],
      ['2026-11-04', 150, 6250]
    ]);
    expect(world.payments.size).toBe(0);
  });

  it('holds the quoted total a day ahead, then captures it before care starts', async () => {
    const world = makeWorld();
    await world.step(new Date('2026-10-25T12:00:00.000Z'));
    await world.step(at(CYCLE_1.holdAt, 5));
    let [cycle] = await world.cycles();
    expect(cycle).toMatchObject({
      status: 'authorised',
      chargeMode: 'hold',
      attempts: 1,
      serviceCents: 12500,
      familyFeeCents: 625,
      familyFeeTaxCents: 81,
      familyTotalCents: FAMILY_TOTAL,
      providerCommissionCents: 1875,
      providerCommissionTaxCents: 94,
      providerShareCents: 10531,
      heldCents: FAMILY_TOTAL
    });
    expect(cycle!.taxLines.map((line) => line.label)).toEqual(['HST (ON) 13%', 'GST (MB) 5%']);
    const [payment] = [...world.payments.values()];
    expect(payment).toMatchObject({
      kind: 'contract_cycle',
      status: 'authorised',
      totalCents: FAMILY_TOTAL,
      description: 'Care with Sam T. · Mon, Nov 2 – Wed, Nov 4'
    });
    expect(payment!.taxLines.map((line) => line.label)).toEqual(['HST (ON) 13%']);

    // Rerunning at the same instant changes nothing.
    await world.step(at(CYCLE_1.holdAt, 5));
    expect(world.payments.size).toBe(1);

    await world.step(at(CYCLE_1.captureAt, 1));
    [cycle] = await world.cycles();
    expect(cycle).toMatchObject({ status: 'captured', capturedCents: FAMILY_TOTAL });
    expect(world.billing().status).toBe('active');
    expect(world.billingState.ledger.map((entry) => [entry.kind, entry.amountCents])).toEqual([
      ['session', 6250],
      ['session', 6250],
      ['family_fee', 625],
      ['family_fee_tax', 81],
      ['provider_commission', 1875],
      ['provider_commission_tax', 94],
      ['capture', FAMILY_TOTAL]
    ]);
    // Sessions complete once they have ended.
    await world.step(new Date('2026-11-03T12:00:00.000Z'));
    expect(
      world
        .sessions()
        .slice(0, 2)
        .map((s) => s.status)
    ).toEqual(['completed', 'scheduled']);
    expect(world.mails).toEqual([]);
  });

  it('bills nothing past the last day once notice is given', async () => {
    // Notice on 21 Oct → last working day 4 Nov; cycle 2 (Nov 5–7) never exists.
    const world = makeWorld({ contract: { endNoticedAt: new Date('2026-10-21T15:00:00.000Z') } });
    await world.step(new Date('2026-10-25T12:00:00.000Z'));
    expect((await world.cycles()).map((c) => c.index)).toEqual([0]);
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.captureAt, 1));
    expect((await world.cycles())[0]).toMatchObject({ status: 'captured' });
    await world.step(new Date('2026-11-06T12:00:00.000Z'));
    expect(world.billing().status).toBe('ended');
  });
});

describe('declines, grace, suspension and resume', () => {
  it('starts a grace period on a declined hold and retries at once on a new card', async () => {
    const world = makeWorld({ card: 'mock_pm_decline' });
    await world.step(at(CYCLE_1.holdAt, 5));
    let [cycle] = await world.cycles();
    expect(cycle).toMatchObject({ status: 'grace', attempts: 1 });
    expect(cycle!.nextRetryAt).toEqual(at(CYCLE_1.holdAt, 5 + 12 * 60));
    expect(world.mailTo('family-1')).toEqual([
      'Your card was declined — update it to keep your care booked'
    ]);
    expect(world.mailTo('helper-1')).toEqual(['Payment for Mon, Nov 2 – Wed, Nov 4 is pending']);

    // The automatic retry is not due yet.
    await world.step(at(CYCLE_1.holdAt, 60));
    expect((await world.cycles())[0]!.attempts).toBe(1);

    world.setCard('mock_pm_new');
    await world.run(
      retryFamilyBilling('family-1', at(CYCLE_1.holdAt, 90)).pipe(Effect.provide(world.layer))
    );
    [cycle] = await world.cycles();
    expect(cycle).toMatchObject({ status: 'authorised', attempts: 2 });
    // One notice only, however many retries.
    expect(world.mailTo('family-1')).toHaveLength(1);
  });

  it('suspends at the cycle start, never bills those days, and resumes the prorated rest', async () => {
    const world = makeWorld({ card: 'mock_pm_decline' });
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.holdAt, 5 + 12 * 60 + 1)); // automatic retry, declined
    expect((await world.cycles())[0]!.attempts).toBe(2);
    await world.step(at(CYCLE_1.startsAt, 1));
    expect((await world.cycles())[0]!.status).toBe('suspended');
    expect(world.billing()).toMatchObject({ status: 'suspended', suspendedReason: 'card' });
    expect(
      world
        .sessions()
        .filter((s) => s.date <= '2026-11-04')
        .map((s) => s.status)
    ).toEqual(['suspended', 'suspended']);
    expect(world.mailTo('helper-1')).toContain(
      "Don't work Mon, Nov 2 – Wed, Nov 4 — payment hasn't been received"
    );
    // A tick never resumes a card suspension by itself.
    await world.step(new Date('2026-11-03T12:00:00.000Z'));
    expect(world.billing().status).toBe('suspended');

    // Tuesday: the card is fixed. Monday's session stays unbilled; only
    // Wednesday's $62.50 (+ fee 3.13 and HST 0.41) is charged, at once.
    world.setCard('mock_pm_new');
    await world.run(
      retryFamilyBilling('family-1', new Date('2026-11-03T12:00:00.000Z')).pipe(
        Effect.provide(world.layer)
      )
    );
    const [cycle] = await world.cycles();
    expect(cycle).toMatchObject({
      status: 'captured',
      chargeMode: 'resume',
      serviceCents: 6250,
      familyTotalCents: 6250 + 313 + 41
    });
    expect(world.billing()).toMatchObject({ status: 'active', suspendedReason: null });
    expect(
      world
        .sessions()
        .filter((s) => s.date <= '2026-11-04')
        .map((s) => s.status)
    ).toEqual(['suspended', 'scheduled']);
    expect(world.mailTo('family-1')).toContain('Your contract has resumed');
    expect(world.mailTo('helper-1')).toContain('Your contract has resumed');
  });

  it('suspends a later cycle that starts while suspended, without holding it', async () => {
    const world = makeWorld({ card: 'mock_pm_decline' });
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.startsAt, 1));
    const paymentsBefore = world.payments.size;
    await world.step(new Date('2026-11-05T06:00:00.000Z')); // cycle 2 has started
    const cycles = await world.cycles();
    expect(cycles[1]!.status).toBe('suspended');
    expect(world.payments.size).toBe(paymentsBefore);
  });
});

describe('late bookings', () => {
  it('authorises and captures at once when accepted less than the hold lead before the first session', async () => {
    const acceptedAt = new Date('2026-11-02T08:00:00.000Z'); // first session in 12.5 h
    const world = makeWorld({ billing: { billableFrom: acceptedAt } });
    await world.run(
      startContractBilling('contract-1', acceptedAt).pipe(Effect.provide(world.layer))
    );
    expect((await world.cycles())[0]).toMatchObject({
      status: 'captured',
      chargeMode: 'immediate'
    });
    expect([...world.payments.values()][0]).toMatchObject({ status: 'captured' });
  });

  it('does not activate the first session when that charge is declined', async () => {
    const acceptedAt = new Date('2026-11-02T08:00:00.000Z');
    const world = makeWorld({ billing: { billableFrom: acceptedAt }, card: 'mock_pm_decline' });
    await world.run(
      startContractBilling('contract-1', acceptedAt).pipe(Effect.provide(world.layer))
    );
    expect((await world.cycles())[0]!.status).toBe('suspended');
    expect(world.billing()).toMatchObject({ status: 'suspended', suspendedReason: 'card' });
  });

  it('places a normal hold when accepted after the hold time but a lead or more before the first session', async () => {
    const acceptedAt = new Date('2026-11-01T12:00:00.000Z'); // first session in 32.5 h
    const world = makeWorld({ billing: { billableFrom: acceptedAt } });
    await world.run(
      startContractBilling('contract-1', acceptedAt).pipe(Effect.provide(world.layer))
    );
    expect((await world.cycles())[0]).toMatchObject({ status: 'authorised', chargeMode: 'hold' });
  });
});

describe('payment-readiness gate', () => {
  const awaiting = { status: 'awaiting_payment_readiness' as const, billableFrom: null };

  it('reminds at acceptance, then 3 days out copying the family, and never holds', async () => {
    const world = makeWorld({ billing: awaiting, helperReady: false });
    await world.run(
      startContractBilling('contract-1', new Date('2026-10-26T15:00:00.000Z')).pipe(
        Effect.provide(world.layer)
      )
    );
    expect(world.mailTo('helper-1')).toEqual([
      'Set up your payout account so your contract can start'
    ]);
    // 7 days out (Oct 26 → Nov 2) is reached at acceptance: not sent again.
    await world.step(new Date('2026-10-27T15:00:00.000Z'));
    expect(world.mailTo('helper-1')).toHaveLength(1);
    await world.step(new Date('2026-10-30T15:00:00.000Z')); // 3 days out
    expect(world.mailTo('helper-1')).toHaveLength(2);
    expect(world.mailTo('family-1')).toEqual(["Sam T. hasn't finished setting up payouts yet"]);
    await world.step(at(CYCLE_1.holdAt, 30));
    expect(world.payments.size).toBe(0);
  });

  it('cancels at the cycle-1 capture deadline with nothing charged', async () => {
    const world = makeWorld({ billing: awaiting, helperReady: false });
    await world.step(new Date('2026-10-30T15:00:00.000Z'));
    await world.step(at(CYCLE_1.captureAt, 1));
    expect(world.billing().status).toBe('cancelled');
    expect(world.ended).toHaveLength(1);
    expect((await world.cycles()).every((c) => c.status === 'cancelled')).toBe(true);
    expect(world.sessions().every((s) => s.status === 'cancelled')).toBe(true);
    expect(world.payments.size).toBe(0);
    expect(world.mailTo('family-1')).toContain('Your contract was cancelled before it started');
    expect(world.mailTo('helper-1')).toContain('Your contract was cancelled before it started');
  });

  it('becomes billable once the helper is ready, applying the late-booking rule', async () => {
    const world = makeWorld({ billing: awaiting, helperReady: false });
    await world.step(new Date('2026-10-30T15:00:00.000Z'));
    world.payouts.rows.set('helper-1', readyAccount());
    const readyAt = new Date('2026-11-02T06:00:00.000Z'); // < 24 h before Mon 15:30
    await world.step(readyAt);
    expect(world.billing()).toMatchObject({ status: 'active', billableFrom: readyAt });
    expect((await world.cycles())[0]).toMatchObject({
      status: 'captured',
      chargeMode: 'immediate'
    });
  });
});

describe('pre-cycle recheck and system failures', () => {
  it('releases the hold and suspends when the helper is no longer ready at capture', async () => {
    const world = makeWorld();
    await world.step(at(CYCLE_1.holdAt, 5));
    world.payouts.rows.delete('helper-1');
    await world.step(at(CYCLE_1.captureAt, 1));
    expect((await world.cycles())[0]!.status).toBe('suspended');
    expect(world.billing()).toMatchObject({
      status: 'suspended',
      suspendedReason: 'helper_not_ready'
    });
    expect([...world.payments.values()][0]).toMatchObject({
      status: 'failed',
      lastError: 'hold released'
    });
    expect(world.alerts.some((subject) => subject.includes('Helper not payment-ready'))).toBe(true);
    expect(world.billingState.ledger.map((entry) => entry.kind)).toEqual(['hold_released']);
    // Once the helper is ready again, the prorated rest is charged by itself.
    world.payouts.rows.set('helper-1', readyAccount());
    await world.step(new Date('2026-11-03T12:00:00.000Z'));
    expect((await world.cycles())[0]).toMatchObject({ status: 'captured', chargeMode: 'resume' });
    expect(world.billing().status).toBe('active');
  });

  it('retries a provider outage under the same key, then suspends without blaming the card', async () => {
    const world = makeWorld({ providerDown: true });
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.holdAt, 20));
    expect((await world.cycles())[0]).toMatchObject({ status: 'authorising', attempts: 1 });
    expect(world.payments.size).toBe(1);
    await world.step(at(CYCLE_1.startsAt, 1));
    expect(world.billing()).toMatchObject({
      status: 'suspended',
      suspendedReason: 'provider_unavailable'
    });
    expect(world.mailTo('family-1')).toEqual([]);
    expect(world.alerts.some((subject) => subject.includes('provider_unavailable'))).toBe(true);
  });

  it('records an incident and alerts an admin when a funded hold disappears', async () => {
    let lost = false;
    const mock = makeMockPayments();
    const world = makeWorld({
      payments: {
        chargeSavedCard: mock.chargeSavedCard,
        cancelPayment: mock.cancelPayment,
        getPayment: (reference) =>
          mock
            .getPayment(reference)
            .pipe(
              Effect.map(
                (payment): ProviderPayment =>
                  lost && payment.status === 'authorised'
                    ? { ...payment, status: 'canceled' }
                    : payment
              )
            ),
        capturePayment: () =>
          Effect.fail(new PaymentProviderError({ operation: 'capturePayment', cause: 'expired' }))
      }
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    // The hold expires at the provider, and the recovery charge on the
    // family's card is declined too.
    lost = true;
    world.setCard('mock_pm_decline');
    await world.step(at(CYCLE_1.captureAt, 1));
    const [cycle] = await world.cycles();
    expect(cycle!.status).toBe('capture_failed');
    expect(world.billingState.incidents.map((incident) => incident.kind)).toEqual([
      'capture_failed'
    ]);
    expect(world.alerts.some((subject) => subject.includes('Funded cycle lost its payment'))).toBe(
      true
    );
    // Represented as funded: the helper is never told not to work.
    expect(world.mailTo('helper-1')).toEqual([]);
    expect(world.billing().status).toBe('scheduled');
  });

  it('recovers a lost hold with one charge on the family card', async () => {
    let lost = false;
    const mock = makeMockPayments();
    const world = makeWorld({
      payments: {
        chargeSavedCard: mock.chargeSavedCard,
        // The surviving hold is cancelled at the same provider first.
        cancelPayment: mock.cancelPayment,
        getPayment: (reference) =>
          mock
            .getPayment(reference)
            .pipe(
              Effect.map(
                (payment): ProviderPayment =>
                  lost && payment.status === 'authorised'
                    ? { ...payment, status: 'canceled' }
                    : payment
              )
            ),
        capturePayment: () =>
          Effect.fail(new PaymentProviderError({ operation: 'capturePayment', cause: 'expired' }))
      }
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    lost = true;
    await world.step(at(CYCLE_1.captureAt, 1));
    expect((await world.cycles())[0]).toMatchObject({ status: 'captured', attempts: 2 });
    expect(world.billingState.incidents).toHaveLength(1);
  });
});

describe('carry-over and the tick', () => {
  it('carries a cycle under 50¢ into the next one', async () => {
    // A 1-minute Monday session at $25/h is 42¢ of service.
    const world = makeWorld({
      version: {
        services: [
          {
            serviceId: 'svc-1',
            name: 'Childcare',
            listedRateCents: 2500,
            rateCents: 2500,
            currency: 'CAD',
            sessions: [{ weekday: 0, startMinutes: 930, endMinutes: 931 }],
            expectations: ''
          }
        ]
      }
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    const [first, second] = await world.cycles();
    expect(first).toMatchObject({ status: 'carried', carriedOutCents: 42 });
    expect(second).toMatchObject({ carriedInCents: 42 });
    expect(world.payments.size).toBe(0);
    expect(world.billingState.ledger.map((entry) => entry.kind)).toEqual(['carry_forward']);
  });

  it('runs every live contract and isolates failures', async () => {
    const world = makeWorld();
    const summary = await world.run(
      runContractBillingTick(at(CYCLE_1.holdAt, 5)).pipe(Effect.provide(world.layer))
    );
    expect(summary).toEqual({ contracts: 1, ran: 1, failed: 0 });
    expect((await world.cycles())[0]!.status).toBe('authorised');
  });
});

// ---------------------------------------------------------------------------
// Fix round 2026-10-24: provider trouble never double-charges, strands a
// cycle or loses money.

const providerFails = (operation: PaymentProviderError['operation']) =>
  Effect.fail(new PaymentProviderError({ operation, cause: 'timeout' }));

const staleReadyAccount = () => ({ ...readyAccount(), refreshedAt: new Date(0) });

const TUESDAY = new Date('2026-11-03T12:00:00.000Z');

describe('captures (H1)', () => {
  it('recognises a capture whose response was lost instead of charging a recovery', async () => {
    const mock = makeMockPayments();
    const world = makeWorld({
      payments: {
        ...mock,
        capturePayment: (input) =>
          mock.capturePayment(input).pipe(Effect.zipRight(providerFails('capturePayment')))
      }
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.captureAt, 1));
    expect((await world.cycles())[0]).toMatchObject({
      status: 'captured',
      capturedCents: FAMILY_TOTAL
    });
    expect(world.payments.size).toBe(1);
    expect(world.billingState.incidents).toEqual([]);
  });

  it('retries a transient capture error under the same key while the hold stands', async () => {
    const mock = makeMockPayments();
    let down = true;
    const keys: Array<string> = [];
    const world = makeWorld({
      payments: {
        ...mock,
        capturePayment: (input) => {
          keys.push(input.idempotencyKey);
          return down ? providerFails('capturePayment') : mock.capturePayment(input);
        }
      }
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.captureAt, 1));
    expect((await world.cycles())[0]!.status).toBe('capturing');
    // Care has started, yet the hold stands: never a system failure.
    await world.step(at(CYCLE_1.captureAt, 20));
    expect((await world.cycles())[0]!.status).toBe('capturing');
    expect(world.billingState.incidents).toEqual([]);
    down = false;
    await world.step(at(CYCLE_1.captureAt, 35));
    expect((await world.cycles())[0]).toMatchObject({ status: 'captured' });
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(world.payments.size).toBe(1);
  });

  it('cancels whatever is left of a refused hold before the one recovery charge', async () => {
    const mock = makeMockPayments();
    let lost = false;
    const calls: Array<string> = [];
    const world = makeWorld({
      payments: {
        ...mock,
        chargeSavedCard: (input) => {
          calls.push('charge');
          return mock.chargeSavedCard(input);
        },
        cancelPayment: (reference) => {
          calls.push('cancel');
          return mock.cancelPayment(reference);
        },
        getPayment: (reference) =>
          mock
            .getPayment(reference)
            .pipe(
              Effect.map(
                (payment): ProviderPayment =>
                  lost && payment.status === 'authorised'
                    ? { ...payment, status: 'canceled' }
                    : payment
              )
            ),
        capturePayment: () => providerFails('capturePayment')
      }
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    lost = true;
    await world.step(at(CYCLE_1.captureAt, 1));
    expect(calls).toEqual(['charge', 'cancel', 'charge']);
    expect((await world.cycles())[0]).toMatchObject({ status: 'captured', attempts: 2 });
    expect(world.billingState.incidents).toHaveLength(1);
  });
});

describe('payment readiness that cannot be confirmed (H2)', () => {
  const payoutsUnreachable = (mock = makeMockPayments()) => ({
    ...mock,
    getPayoutAccount: () => providerFails('getPayoutAccount')
  });

  it('never releases a valid hold when the readiness refresh fails', async () => {
    const mock = makeMockPayments();
    let payoutsDown = false;
    const world = makeWorld({
      payments: {
        ...mock,
        getPayoutAccount: (reference) =>
          payoutsDown ? providerFails('getPayoutAccount') : mock.getPayoutAccount(reference)
      }
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    world.payouts.rows.set('helper-1', staleReadyAccount());
    payoutsDown = true;
    await world.step(at(CYCLE_1.captureAt, 1));
    expect((await world.cycles())[0]!.status).toBe('authorised');
    expect([...world.payments.values()][0]!.status).toBe('authorised');
    expect(world.billing().status).toBe('scheduled');
    expect(world.mailTo('helper-1')).toEqual([]);
    expect(world.billingState.ledger).toEqual([]);
    payoutsDown = false;
    await world.step(at(CYCLE_1.captureAt, 20));
    expect((await world.cycles())[0]!.status).toBe('captured');
  });

  it('places no hold and suspends nothing while readiness is unknown', async () => {
    const world = makeWorld({ payments: payoutsUnreachable() });
    world.payouts.rows.set('helper-1', staleReadyAccount());
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.startsAt, 1));
    await world.step(at(CYCLE_1.startsAt, 20));
    expect((await world.cycles())[0]!.status).toBe('scheduled');
    expect(world.payments.size).toBe(0);
    expect(world.billing().status).toBe('scheduled');
    expect(world.mails).toEqual([]);
    // One admin alert, however many ticks.
    expect(world.alerts.filter((subject) => subject.includes('readiness'))).toHaveLength(1);
  });

  it('never cancels at the readiness deadline on an unconfirmed status', async () => {
    const world = makeWorld({
      billing: { status: 'awaiting_payment_readiness', billableFrom: null },
      payments: payoutsUnreachable()
    });
    world.payouts.rows.set('helper-1', { ...staleReadyAccount(), status: 'restricted' });
    await world.step(at(CYCLE_1.captureAt, 1));
    expect(world.billing().status).toBe('awaiting_payment_readiness');
    expect(world.ended).toEqual([]);
  });
});

describe('resume through provider trouble (M1, M7)', () => {
  const suspendedWorld = (chargeDown: () => boolean) => {
    const mock = makeMockPayments();
    return makeWorld({
      card: 'mock_pm_decline',
      payments: {
        ...mock,
        chargeSavedCard: (input) =>
          chargeDown() ? providerFails('chargeSavedCard') : mock.chargeSavedCard(input)
      }
    });
  };

  it('keeps a resume the provider never answered pending, then resumes with both notices', async () => {
    let down = false;
    const world = suspendedWorld(() => down);
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.startsAt, 1));
    expect(world.billing().status).toBe('suspended');
    world.setCard('mock_pm_new');
    down = true;
    await world.run(retryFamilyBilling('family-1', TUESDAY).pipe(Effect.provide(world.layer)));
    expect((await world.cycles())[0]).toMatchObject({
      status: 'authorising',
      chargeMode: 'resume'
    });
    await world.step(at(TUESDAY, 15));
    // Never active without the money.
    expect(world.billing().status).toBe('suspended');
    down = false;
    await world.step(at(TUESDAY, 30));
    expect((await world.cycles())[0]).toMatchObject({ status: 'captured', chargeMode: 'resume' });
    expect(world.billing().status).toBe('active');
    const resumed = (prefix: string) =>
      world.mails.find(
        (mail) => mail.email.startsWith(prefix) && mail.subject === 'Your contract has resumed'
      );
    // The family sees what it paid; the helper what they receive (M7).
    expect(resumed('family-1')?.paragraphs[0]).toContain('$66.04');
    expect(resumed('helper-1')?.paragraphs[0]).toContain('$52.65');
  });

  it('gives up a resume quote once its first session has started, never charging elapsed care', async () => {
    let down = false;
    const world = suspendedWorld(() => down);
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.startsAt, 1));
    world.setCard('mock_pm_new');
    down = true;
    await world.run(retryFamilyBilling('family-1', TUESDAY).pipe(Effect.provide(world.layer)));
    // Wednesday's session started at 15:30 EST (20:30Z).
    await world.step(new Date('2026-11-04T20:40:00.000Z'));
    expect((await world.cycles())[0]!.status).toBe('suspended');
    expect(world.billing()).toMatchObject({
      status: 'suspended',
      suspendedReason: 'provider_unavailable'
    });
    down = false;
    await world.step(new Date('2026-11-04T21:00:00.000Z'));
    expect([...world.payments.values()].some((row) => row.status === 'captured')).toBe(false);
    expect(world.billing().status).toBe('active');
  });
});

describe('cycles never stuck in authorising (M2)', () => {
  it('moves the cycle on when its attempt was failed without a provider answer', async () => {
    const world = makeWorld({ providerDown: true });
    await world.step(at(CYCLE_1.holdAt, 5));
    const [payment] = [...world.payments.values()];
    // A crash right after the payment row was failed, before the cycle moved.
    world.payments.set(payment!.id, {
      ...payment!,
      status: 'failed',
      lastError: 'There is no card on file.'
    });
    await world.step(at(CYCLE_1.holdAt, 20));
    expect((await world.cycles())[0]!.status).toBe('grace');
  });

  it('flags a provider answer that does not match the row, releases it and retries', async () => {
    const mock = makeMockPayments();
    const world = makeWorld({
      payments: {
        ...mock,
        chargeSavedCard: (input) =>
          mock
            .chargeSavedCard(input)
            .pipe(Effect.map((payment) => ({ ...payment, amountCents: payment.amountCents + 1 })))
      }
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    expect((await world.cycles())[0]!.status).toBe('grace');
    // Not the card's fault: the family is not asked to change it.
    expect(world.mailTo('family-1')).toEqual([]);
    expect(world.alerts.some((subject) => subject.includes('does not match'))).toBe(true);
    const [payment] = [...world.payments.values()];
    expect(payment!.status).toBe('failed');
    const atProvider = await world.run(mock.getPayment(payment!.providerReference!));
    expect(atProvider.status).toBe('canceled');
  });
});

describe('concurrent retries (M3)', () => {
  it('never reuses an attempt key when two retries start from one snapshot', async () => {
    const mock = makeMockPayments();
    const keys: Array<string> = [];
    const world = makeWorld({
      card: 'mock_pm_decline',
      payments: {
        ...mock,
        chargeSavedCard: (input) => {
          keys.push(input.idempotencyKey);
          return mock.chargeSavedCard(input);
        }
      },
      // Both callers read the cycle before either claims it.
      paymentRepo: (service) => ({
        ...service,
        create: (input) => Effect.yieldNow().pipe(Effect.zipRight(service.create(input)))
      })
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    const retry = retryFamilyBilling('family-1', at(CYCLE_1.holdAt, 90));
    await world.run(
      Effect.all([retry, retry], { concurrency: 'unbounded' }).pipe(Effect.provide(world.layer))
    );
    expect(keys.length).toBeGreaterThan(1);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('lost charge responses (M4)', () => {
  const lostResponses = (mock: ReturnType<typeof makeMockPayments>) => ({
    chargeSavedCard: (input: Parameters<typeof mock.chargeSavedCard>[0]) =>
      mock.chargeSavedCard(input).pipe(Effect.zipRight(providerFails('chargeSavedCard')))
  });

  it('finds a hold whose response was lost at the cycle start instead of orphaning it', async () => {
    const mock = makeMockPayments();
    const world = makeWorld({ payments: { ...mock, ...lostResponses(mock) } });
    await world.step(at(CYCLE_1.holdAt, 5));
    expect((await world.cycles())[0]!.status).toBe('authorising');
    await world.step(at(CYCLE_1.startsAt, 1));
    expect((await world.cycles())[0]!.status).toBe('authorised');
    const [held] = [...world.payments.values()];
    expect(held!.status).toBe('authorised');
    expect(held!.providerReference).toStartWith('mock_pi_');
    await world.step(at(CYCLE_1.captureAt, 1));
    expect((await world.cycles())[0]!.status).toBe('captured');
  });

  it('resolves an attempt it could not look up later, releasing the hold it finds', async () => {
    const mock = makeMockPayments();
    let searchDown = true;
    const world = makeWorld({
      payments: {
        ...mock,
        ...lostResponses(mock),
        findPaymentByRowId: (id) =>
          searchDown ? providerFails('findPaymentByRowId') : mock.findPaymentByRowId(id)
      }
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.startsAt, 1));
    expect(world.billing()).toMatchObject({
      status: 'suspended',
      suspendedReason: 'provider_unavailable'
    });
    const [payment] = [...world.payments.values()];
    expect(payment!.status).toBe('pending');
    searchDown = false;
    await world.step(at(CYCLE_1.startsAt, 20));
    const resolved = world.payments.get(payment!.id)!;
    expect(resolved.status).toBe('failed');
    expect(resolved.providerReference).toStartWith('mock_pi_');
    expect((await world.run(mock.getPayment(resolved.providerReference!))).status).toBe(
      'canceled'
    );
  });
});

describe('recovery after a system failure (M5)', () => {
  const lostHoldWorld = (options: { chargeDown?: () => boolean } = {}) => {
    const mock = makeMockPayments();
    let lost = false;
    const keys: Array<string> = [];
    const world = makeWorld({
      payments: {
        ...mock,
        chargeSavedCard: (input) => {
          keys.push(input.idempotencyKey);
          return options.chargeDown?.()
            ? providerFails('chargeSavedCard')
            : mock.chargeSavedCard(input);
        },
        getPayment: (reference) =>
          mock
            .getPayment(reference)
            .pipe(
              Effect.map(
                (payment): ProviderPayment =>
                  lost && payment.status === 'authorised'
                    ? { ...payment, status: 'canceled' }
                    : payment
              )
            ),
        capturePayment: () => providerFails('capturePayment')
      }
    });
    return { world, keys, loseHold: () => (lost = true) };
  };

  it('retries a declined recovery charge on schedule and when the card is replaced', async () => {
    const { world, loseHold } = lostHoldWorld();
    await world.step(at(CYCLE_1.holdAt, 5));
    loseHold();
    world.setCard('mock_pm_decline');
    await world.step(at(CYCLE_1.captureAt, 1));
    expect((await world.cycles())[0]).toMatchObject({ status: 'capture_failed', attempts: 2 });
    await world.step(at(CYCLE_1.captureAt, 60)); // not due yet
    expect((await world.cycles())[0]!.attempts).toBe(2);
    await world.step(at(CYCLE_1.captureAt, 12 * 60 + 5)); // automatic retry, declined
    expect((await world.cycles())[0]).toMatchObject({ status: 'capture_failed', attempts: 3 });
    world.setCard('mock_pm_new');
    await world.run(
      retryFamilyBilling('family-1', at(CYCLE_1.captureAt, 13 * 60)).pipe(
        Effect.provide(world.layer)
      )
    );
    expect((await world.cycles())[0]).toMatchObject({ status: 'captured', attempts: 4 });
    expect(world.billingState.incidents).toHaveLength(1);
  });

  it('retries a recovery charge the provider never answered under the same key', async () => {
    let down = false;
    const { world, keys, loseHold } = lostHoldWorld({ chargeDown: () => down });
    await world.step(at(CYCLE_1.holdAt, 5));
    loseHold();
    down = true;
    await world.step(at(CYCLE_1.captureAt, 1));
    expect((await world.cycles())[0]!.status).toBe('capture_failed');
    down = false;
    await world.step(at(CYCLE_1.captureAt, 20));
    expect((await world.cycles())[0]!.status).toBe('captured');
    const recoveryKeys = keys.filter((key) => key.startsWith('recover-'));
    expect(recoveryKeys).toHaveLength(2);
    expect(new Set(recoveryKeys).size).toBe(1);
  });
});

describe('reduced captures (M6)', () => {
  it('writes what was captured onto the payment row', async () => {
    const world = makeWorld();
    await world.step(at(CYCLE_1.holdAt, 5));
    // Wednesday's session is cancelled before the capture.
    world.billingState.sessions = world.billingState.sessions.map((session) =>
      session.date === '2026-11-04' ? { ...session, status: 'cancelled' } : session
    );
    await world.step(at(CYCLE_1.captureAt, 1));
    expect((await world.cycles())[0]).toMatchObject({
      status: 'captured',
      serviceCents: 6250,
      familyTotalCents: 6604,
      capturedCents: 6604
    });
    const [payment] = [...world.payments.values()];
    expect(payment).toMatchObject({
      amountCents: 6250,
      feeCents: 313,
      taxCents: 41,
      capturedCents: 6604,
      totalCents: FAMILY_TOTAL
    });
    expect(payment!.taxLines.map((line) => [line.label, line.taxCents])).toEqual([
      ['HST (ON) 13%', 41]
    ]);
  });
});

describe('carried amounts and absorbed resumes (L1, L2)', () => {
  const oneMinute = {
    services: [
      {
        serviceId: 'svc-1',
        name: 'Childcare',
        listedRateCents: 2500,
        rateCents: 2500,
        currency: 'CAD' as const,
        sessions: [
          { weekday: 0, startMinutes: 930, endMinutes: 931 },
          { weekday: 2, startMinutes: 930, endMinutes: 931 }
        ],
        expectations: ''
      }
    ]
  };

  it('resumes a tiny remainder at Poppynz’s cost and lets its sessions complete', async () => {
    const world = makeWorld({ card: 'mock_pm_decline', version: oneMinute });
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.startsAt, 1));
    world.setCard('mock_pm_new');
    await world.run(retryFamilyBilling('family-1', TUESDAY).pipe(Effect.provide(world.layer)));
    const [cycle] = await world.cycles();
    expect(cycle!.status).not.toBe('suspended');
    expect(world.billing().status).toBe('active');
    expect(world.billingState.ledger.map((entry) => entry.entryKey)).toContain(
      `cycle:${cycle!.id}:resume_absorbed`
    );
    await world.step(new Date('2026-11-05T12:00:00.000Z'));
    expect(
      world
        .sessions()
        .filter((s) => s.date === '2026-11-04')
        .map((s) => s.status)
    ).toEqual(['completed']);
  });

  it('charges a carried-in amount with the resumed rest of the cycle', async () => {
    const world = makeWorld({ card: 'mock_pm_decline' });
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.startsAt, 1));
    world.billingState.cycles[0] = { ...world.billingState.cycles[0]!, carriedInCents: 1000 };
    world.setCard('mock_pm_new');
    await world.run(retryFamilyBilling('family-1', TUESDAY).pipe(Effect.provide(world.layer)));
    expect((await world.cycles())[0]).toMatchObject({ status: 'captured', serviceCents: 7250 });
  });

  it('absorbs a carried-in amount whose cycle ended suspended', async () => {
    const world = makeWorld({ card: 'mock_pm_decline' });
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.startsAt, 1));
    world.billingState.cycles[0] = { ...world.billingState.cycles[0]!, carriedInCents: 1000 };
    await world.step(new Date('2026-11-05T12:00:00.000Z'));
    await world.step(new Date('2026-11-05T13:00:00.000Z'));
    const absorbed = world.billingState.ledger.filter((entry) => entry.kind === 'carry_absorbed');
    expect(absorbed.map((entry) => entry.amountCents)).toEqual([1000]);
  });
});

describe("the family's Retry payment button (UAT round 2 #13)", () => {
  const retryNow = (world: ReturnType<typeof makeWorld>, now: Date) =>
    world.run(retryContractPayment('family-1', 'contract-1', now).pipe(Effect.provide(world.layer)));
  const eligible = async (world: ReturnType<typeof makeWorld>, now: Date) =>
    familyRetryEligible(world.billing(), await world.cycles(), now);

  it('has nothing to retry on a funded or merely scheduled contract', async () => {
    const world = makeWorld();
    expect(await eligible(world, at(CYCLE_1.holdAt, 1))).toBe(false);
    await world.step(at(CYCLE_1.holdAt, 5));
    expect(await eligible(world, at(CYCLE_1.holdAt, 6))).toBe(false);
  });

  it('retries a declined hold in its grace period: still declined, then held', async () => {
    const world = makeWorld({ card: 'mock_pm_decline' });
    await world.step(at(CYCLE_1.holdAt, 5));
    expect(await eligible(world, at(CYCLE_1.holdAt, 6))).toBe(true);
    expect(await retryNow(world, at(CYCLE_1.holdAt, 10))).toBe('declined');
    expect((await world.cycles())[0]).toMatchObject({ status: 'grace', attempts: 2 });

    world.setCard('mock_pm_new');
    expect(await retryNow(world, at(CYCLE_1.holdAt, 20))).toBe('charged');
    expect((await world.cycles())[0]).toMatchObject({ status: 'authorised', attempts: 3 });
    expect(await eligible(world, at(CYCLE_1.holdAt, 21))).toBe(false);
  });

  it('resumes a card-suspended contract with the prorated rest', async () => {
    const world = makeWorld({ card: 'mock_pm_decline' });
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.startsAt, 1));
    expect(world.billing()).toMatchObject({ status: 'suspended', suspendedReason: 'card' });
    const tuesday = new Date('2026-11-03T12:00:00.000Z');
    expect(await eligible(world, tuesday)).toBe(true);
    world.setCard('mock_pm_new');
    expect(await retryNow(world, tuesday)).toBe('charged');
    expect(world.billing()).toMatchObject({ status: 'active' });
    expect((await world.cycles())[0]).toMatchObject({ status: 'captured', chargeMode: 'resume' });
  });

  it('reports an attempt the provider has not answered as in progress', async () => {
    let down = false;
    const world = makeWorld({
      card: 'mock_pm_decline',
      payments: (mock) => ({
        chargeSavedCard: (input: ChargeSavedCardInput) =>
          down
            ? Effect.fail(new PaymentProviderError({ operation: 'chargeSavedCard', cause: 'timeout' }))
            : mock.chargeSavedCard(input)
      })
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    expect((await world.cycles())[0]!.status).toBe('grace');
    world.setCard('mock_pm_new');
    down = true;
    expect(await retryNow(world, at(CYCLE_1.holdAt, 10))).toBe('in_progress');
  });

  it("never touches the family's other contracts", async () => {
    const world = makeWorld({ card: 'mock_pm_decline' });
    await world.step(at(CYCLE_1.holdAt, 5));
    world.setCard('mock_pm_new');
    await world.run(
      retryContractPayment('family-1', 'contract-2', at(CYCLE_1.holdAt, 10)).pipe(
        Effect.provide(world.layer)
      )
    );
    expect((await world.cycles())[0]).toMatchObject({ status: 'grace', attempts: 1 });
  });
});

describe('configuration (L6)', () => {
  it('refuses to bill on a malformed setting instead of defaulting', async () => {
    const world = makeWorld();
    const exit = await Effect.runPromiseExit(
      runContractBilling('contract-1', at(CYCLE_1.holdAt, 5)).pipe(
        Effect.provide(world.layer),
        Effect.withConfigProvider(
          ConfigProvider.fromMap(new Map([['CONTRACT_PROVIDER_COMMISSION_BPS', 'fifteen']]))
        )
      )
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(world.payments.size).toBe(0);
  });

  it.each(['0', '73', 'one day', '1.5'])(
    'refuses to bill on CONTRACT_HOLD_LEAD_HOURS=%s',
    async (value) => {
      const world = makeWorld();
      const exit = await Effect.runPromiseExit(
        runContractBilling('contract-1', at(CYCLE_1.holdAt, 5)).pipe(
          Effect.provide(world.layer),
          Effect.withConfigProvider(
            ConfigProvider.fromMap(new Map([['CONTRACT_HOLD_LEAD_HOURS', value]]))
          )
        )
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(world.payments.size).toBe(0);
    }
  );

  it('plans new cycles with CONTRACT_HOLD_LEAD_HOURS and keeps stored hold times', async () => {
    const world = makeWorld();
    const withLead = (hours: string, now: Date) =>
      Effect.runPromise(
        runContractBilling('contract-1', now).pipe(
          Effect.provide(world.layer),
          Effect.withConfigProvider(
            ConfigProvider.fromMap(new Map([['CONTRACT_HOLD_LEAD_HOURS', hours]]))
          )
        )
      );
    // Planned with 48 h: cycle 1 is held 48 real hours before Mon 00:00 EST.
    await withLead('48', new Date('2026-10-26T12:00:00.000Z'));
    const planned = await world.cycles();
    expect(planned[0]!.holdAt.toISOString()).toBe('2026-10-31T05:00:00.000Z');
    // Changing the setting later never moves a cycle already planned; the
    // next cycles planned (further into the window) use the new value.
    await withLead('12', new Date('2026-10-30T12:00:00.000Z'));
    const after = await world.cycles();
    expect(after[0]!.holdAt.toISOString()).toBe('2026-10-31T05:00:00.000Z');
    const fresh = after.find((cycle) => !planned.some((row) => row.index === cycle.index));
    expect(fresh).toBeDefined();
    expect(fresh!.holdAt.getTime()).toBe(fresh!.startsAt.getTime() - 12 * 60 * 60 * 1000);
  });
});

describe('card dialog preview (B2)', () => {
  it('says what replacing the card would charge on a card-suspended contract', async () => {
    const world = makeWorld({ card: 'mock_pm_decline' });
    const preview = () =>
      world.run(previewCardResumes('family-1', TUESDAY).pipe(Effect.provide(world.layer)));
    expect(await preview()).toEqual([]);
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.startsAt, 1));
    expect(await preview()).toEqual([
      { contractId: 'contract-1', dates: 'Mon, Nov 2 – Wed, Nov 4', amountCents: 6604 }
    ]);
    // Nothing was charged by asking.
    expect([...world.payments.values()].some((row) => row.status === 'captured')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round 3 (2026-10-24): a lost response never orphans a charge, a replaced
// card never loops, and a reduced capture survives a crash.

/** Every charge under `key` goes through at the provider, but its answer is
 * lost — the attempt can only be resolved by replay or lookup. */
const loseKey =
  (suffix: string) =>
  (mock: MockPayments): Partial<Context.Tag.Service<typeof Payments>> => ({
    chargeSavedCard: (input) =>
      input.idempotencyKey.endsWith(suffix)
        ? mock.chargeSavedCard(input).pipe(Effect.zipRight(providerFails('chargeSavedCard')))
        : mock.chargeSavedCard(input)
  });

describe('lost responses and the give-up paths (R3)', () => {
  // Accepted ten minutes before the cycle starts: charged at once (late
  // booking), and given up on at the start if unanswered.
  const acceptedAt = at(CYCLE_1.startsAt, -10);

  it('uses a replay of the create as the authoritative lookup when search lags', async () => {
    let lose = true;
    const world = makeWorld({
      billing: { billableFrom: acceptedAt },
      mock: { loseResponses: () => lose, searchLagMs: 10 * 60 * 60_000 }
    });
    await world.start(acceptedAt);
    expect((await world.cycles())[0]!.status).toBe('authorising');
    lose = false;
    await world.step(at(CYCLE_1.startsAt, 1));
    // Search has not indexed the charge yet; the replay returns it.
    expect((await world.cycles())[0]).toMatchObject({ status: 'captured', attempts: 1 });
    const [payment] = [...world.payments.values()];
    expect(payment).toMatchObject({ status: 'captured' });
    expect(payment!.providerReference).toBe(world.mock.intents()[0]!.reference);
    expect(world.mock.intents()).toHaveLength(1);
  });

  it('treats a search miss as unknown until the attempt is an hour old, then releases what it finds', async () => {
    const world = makeWorld({
      billing: { billableFrom: acceptedAt },
      mock: { loseResponses: () => true, searchLagMs: 30 * 60_000 }
    });
    await world.start(acceptedAt);
    await world.step(at(CYCLE_1.startsAt, 1));
    // Replay unanswered, search not caught up, attempt 11 minutes old.
    expect(world.billing()).toMatchObject({
      status: 'suspended',
      suspendedReason: 'provider_unavailable'
    });
    const [payment] = [...world.payments.values()];
    expect(payment!.status).toBe('pending');
    await world.step(at(CYCLE_1.startsAt, 40));
    const resolved = world.payments.get(payment!.id)!;
    // The charge did go through: it is found and refunded, never orphaned.
    expect(resolved.status).toBe('refunded');
    expect(resolved.providerReference).toBe(world.mock.intents()[0]!.reference);
    expect(resolved.refundReference).not.toBeNull();
  });

  it('applies the same age guard when a stale resume charge is given up', async () => {
    let lose = false;
    const world = makeWorld({
      card: 'mock_pm_decline',
      mock: { loseResponses: () => lose, searchLagMs: 2 * 60 * 60_000 }
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.startsAt, 1));
    expect(world.billing().status).toBe('suspended');
    world.setCard('mock_pm_new');
    lose = true;
    // Wednesday 15:00 EST: the resume charge goes through unanswered; the
    // session starts at 15:30, so its quote is stale by the next tick.
    await world.retry(new Date('2026-11-04T20:00:00.000Z'));
    const resume = [...world.payments.values()].at(-1)!;
    expect(resume.status).toBe('pending');
    await world.step(new Date('2026-11-04T20:40:00.000Z'));
    expect((await world.cycles())[0]!.status).toBe('suspended');
    expect(world.payments.get(resume.id)!.status).toBe('pending');
    await world.step(new Date('2026-11-04T23:00:00.000Z'));
    expect(world.payments.get(resume.id)).toMatchObject({ status: 'refunded' });
  });
});

describe('a charge that lands on a given-up attempt (R3 webhook)', () => {
  const acceptedAt = at(CYCLE_1.startsAt, -10);

  it('refunds it automatically and raises an incident', async () => {
    const world = makeWorld({
      billing: { billableFrom: acceptedAt },
      // Search never finds attempt 1; attempt 2 goes through normally.
      mock: { searchLagMs: 10 * 24 * 60 * 60_000 },
      payments: loseKey('-1')
    });
    await world.start(acceptedAt);
    await world.step(at(CYCLE_1.startsAt, 1));
    await world.step(at(CYCLE_1.startsAt, 70));
    const first = [...world.payments.values()][0]!;
    expect(first).toMatchObject({ status: 'failed', providerReference: null });
    // The webhook for attempt 1's charge finally arrives.
    const landed = world.mock.intents().find((intent) => intent.metadata.payment_id === first.id)!;
    expect(landed.status).toBe('succeeded');
    const result = await world.run(
      adoptProviderPayment(first, landed, at(CYCLE_1.startsAt, 90)).pipe(
        Effect.provide(world.layer)
      )
    );
    expect(result.outcome).toBe('released');
    expect(world.payments.get(first.id)).toMatchObject({
      status: 'refunded',
      providerReference: landed.reference
    });
    expect(world.billingState.incidents.map((incident) => incident.kind)).toEqual([
      `orphaned_payment:${landed.reference}`
    ]);
    expect(world.alerts.some((subject) => subject.includes('given-up attempt'))).toBe(true);
    // Adopting the same delivery again changes nothing.
    await world.run(
      adoptProviderPayment(world.payments.get(first.id)!, landed, at(CYCLE_1.startsAt, 95)).pipe(
        Effect.provide(world.layer)
      )
    );
    expect(world.billingState.incidents).toHaveLength(1);
  });

  it('records an unanswered attempt it finds by payment id and settles it', async () => {
    const world = makeWorld({ payments: loseKey('-1') });
    await world.step(at(CYCLE_1.holdAt, 5));
    const [pending] = [...world.payments.values()];
    expect(pending).toMatchObject({ status: 'pending', providerReference: null });
    const landed = world.mock.intents()[0]!;
    const result = await world.run(
      adoptProviderPayment(pending!, landed, at(CYCLE_1.holdAt, 6)).pipe(
        Effect.provide(world.layer)
      )
    );
    expect(result.outcome).toBe('authorised');
    expect((await world.cycles())[0]!.status).toBe('authorised');
    expect(world.payments.get(pending!.id)!.providerReference).toBe(landed.reference);
  });
});

describe('a replaced card under an unanswered attempt (R4)', () => {
  it('charges the attempt its own card, so the replay is not refused', async () => {
    let lose = true;
    const world = makeWorld({ mock: { loseResponses: () => lose } });
    await world.step(at(CYCLE_1.holdAt, 5));
    expect([...world.payments.values()][0]).toMatchObject({ cardReference: 'mock_pm_ok' });
    world.setCard('mock_pm_new');
    lose = false;
    await world.step(at(CYCLE_1.holdAt, 20));
    expect((await world.cycles())[0]).toMatchObject({ status: 'authorised', attempts: 1 });
    expect(world.mock.intents()).toHaveLength(1);
    expect(world.mock.intents()[0]!.paymentMethod?.reference).toBe('mock_pm_ok');
  });

  it('resolves an idempotency refusal by lookup, then starts a new attempt', async () => {
    const world = makeWorld({
      payments: (mock) => ({
        chargeSavedCard: (input) =>
          input.idempotencyKey.endsWith('-1')
            ? Effect.fail(
                new PaymentProviderError({
                  operation: 'chargeSavedCard',
                  cause: 'key reused with different parameters',
                  idempotency: 'mismatch'
                })
              )
            : mock.chargeSavedCard(input)
      })
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.holdAt, 20));
    // Nothing found yet, but a miss is not proof within the first hour.
    expect((await world.cycles())[0]).toMatchObject({ status: 'authorising', attempts: 1 });
    await world.step(at(CYCLE_1.holdAt, 70));
    const [first, second] = [...world.payments.values()];
    expect(first!.status).toBe('failed');
    expect(second).toMatchObject({ status: 'authorised', chargeKey: expect.stringMatching(/-2$/) });
    expect((await world.cycles())[0]).toMatchObject({ status: 'authorised', attempts: 2 });
  });

  it('gives the recovery branch the same lookup instead of looping', async () => {
    let lostHold = false;
    let lose = false;
    const world = makeWorld({
      mock: { loseResponses: () => lose },
      payments: (mock) => ({
        getPayment: (reference) =>
          mock
            .getPayment(reference)
            .pipe(
              Effect.map(
                (payment): ProviderPayment =>
                  lostHold && payment.status === 'authorised'
                    ? { ...payment, status: 'canceled' }
                    : payment
              )
            ),
        capturePayment: () => providerFails('capturePayment')
      })
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    lostHold = true;
    lose = true;
    await world.step(at(CYCLE_1.captureAt, 1));
    expect((await world.cycles())[0]!.status).toBe('capture_failed');
    world.setCard('mock_pm_new');
    lose = false;
    await world.step(at(CYCLE_1.captureAt, 20));
    expect((await world.cycles())[0]).toMatchObject({ status: 'captured', attempts: 2 });
  });

  it('resolves an unanswered attempt as soon as the card is replaced', async () => {
    let lose = true;
    const world = makeWorld({ mock: { loseResponses: () => lose } });
    await world.step(at(CYCLE_1.holdAt, 5));
    world.setCard('mock_pm_new');
    lose = false;
    // The card dialog's retry, not the next tick.
    await world.retry(at(CYCLE_1.holdAt, 8));
    expect((await world.cycles())[0]).toMatchObject({ status: 'authorised', attempts: 1 });
    expect(world.mock.intents()).toHaveLength(1);
  });

  it('never re-sends an attempt under a key the provider has forgotten', async () => {
    let lose = true;
    const world = makeWorld({ mock: { loseResponses: () => lose } });
    await world.step(at(CYCLE_1.holdAt, 5));
    lose = false;
    // 24 h later the key is gone at the provider: a re-send would be a
    // second hold. The attempt is looked up instead.
    await world.step(at(CYCLE_1.holdAt, 5 + 24 * 60 + 10));
    expect(world.mock.intents()).toHaveLength(1);
    expect((await world.cycles())[0]).toMatchObject({ status: 'authorised', attempts: 1 });
  });
});

describe('reduced captures survive a crash (M6)', () => {
  it('writes the reduced breakdown on the next tick when the first write never happened', async () => {
    let crash = true;
    const world = makeWorld({
      paymentRepo: (service) => ({
        ...service,
        update: (id, input) => {
          if (crash && input.amountCents !== undefined) {
            crash = false;
            return Effect.die('crash after claiming the capture');
          }
          return service.update(id, input);
        }
      })
    });
    await world.step(at(CYCLE_1.holdAt, 5));
    world.billingState.sessions = world.billingState.sessions.map((session) =>
      session.date === '2026-11-04' ? { ...session, status: 'cancelled' } : session
    );
    await world.step(at(CYCLE_1.captureAt, 1)).catch(() => undefined);
    expect((await world.cycles())[0]!.status).toBe('capturing');
    await world.step(at(CYCLE_1.captureAt, 20));
    expect((await world.cycles())[0]).toMatchObject({ status: 'captured', capturedCents: 6604 });
    expect([...world.payments.values()][0]).toMatchObject({
      amountCents: 6250,
      feeCents: 313,
      taxCents: 41,
      capturedCents: 6604
    });
  });
});
