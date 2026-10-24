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
  type ProviderPayment
} from '@repo/payments';
import { Context, Effect, Layer } from 'effect';
import {
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
  holdAt: new Date('2026-10-31T04:00:00.000Z'), // Sat 31 Oct 00:00 EDT
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
  /** Overrides on the mock provider (e.g. a re-fetch that says canceled). */
  payments?: Partial<Context.Tag.Service<typeof Payments>>;
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
  const paymentRepo = makeInMemoryPaymentRepo();
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
  const mock = makeMockPayments({ providerDown: options.providerDown });
  const payments = { ...mock, ...options.payments };
  const version = accepted(options.version);

  const layer = Layer.mergeAll(
    billingRepo.layer,
    paymentRepo.layer,
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
  const step = (now: Date) =>
    run(runContractBilling('contract-1', now).pipe(Effect.provide(layer)));
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

  it('holds the quoted total 2 days ahead, then captures it before care starts', async () => {
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
  it('authorises and captures at once when accepted less than 2 days before the first session', async () => {
    const acceptedAt = new Date('2026-11-01T14:00:00.000Z');
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
    const acceptedAt = new Date('2026-11-01T14:00:00.000Z');
    const world = makeWorld({ billing: { billableFrom: acceptedAt }, card: 'mock_pm_decline' });
    await world.run(
      startContractBilling('contract-1', acceptedAt).pipe(Effect.provide(world.layer))
    );
    expect((await world.cycles())[0]!.status).toBe('suspended');
    expect(world.billing()).toMatchObject({ status: 'suspended', suspendedReason: 'card' });
  });

  it('places a normal hold when accepted after the hold time but 2+ days before the first session', async () => {
    const acceptedAt = new Date('2026-10-31T12:00:00.000Z'); // first session in 2 d 8.5 h
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
    const readyAt = new Date('2026-11-01T18:00:00.000Z'); // < 48 h before Mon 15:30
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
