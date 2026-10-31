import { describe, expect, it } from 'bun:test';
import {
  ContractRepo,
  dummyContract,
  dummyContractBilling,
  dummyContractCycle,
  dummySessionResolution,
  makeInMemoryBillingClockRunRepo,
  makeInMemoryContractBillingRepo,
  makeInMemorySessionResolutionRepo,
  type BillingClockRun,
  type CardDispute,
  type ExtraSession,
  type HelperTransfer
} from '@repo/db';
import { makeMockPayments, Payments } from '@repo/payments';
import { Cause, Context, Effect, Exit, Layer, Option } from 'effect';
import {
  billingClockEvents,
  BillingClockError,
  runBillingClock,
  loadBillingClockEvents,
  validateBillingClockTarget
} from './billing-clock';
import { makeIdleContractBillingLayer } from './engine';
import { runSessionResolutionTick } from './resolutions';
import { runBillingTickSteps } from './tick-steps';
import { CYCLE_1, makeWorld } from './test-world';

/** Staging UAT: the admin billing fast-forward (docs/staging-uat.md). */
const BEFORE = new Date('2026-10-25T12:00:00.000Z');
const TRANSFER_1 = new Date('2026-11-07T05:00:00.000Z');

const refusal = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const failure = Cause.failureOption(exit.cause);
  return Option.isSome(failure) && failure.value instanceof BillingClockError
    ? failure.value.reason
    : 'other';
};

/** The test world's contract-1, plus a second live contract that must never
 * move when contract-1 is fast-forwarded. */
const twoContracts = (
  runs: ReadonlyArray<BillingClockRun> = [],
  options: Parameters<typeof makeWorld>[0] = {}
) => {
  const world = makeWorld(options);
  world.billingState.billing.set(
    'contract-2',
    dummyContractBilling({
      contractId: 'contract-2',
      status: 'scheduled',
      billableFrom: new Date('2026-10-20T00:00:00.000Z'),
      acceptedVersionId: 'version-1'
    })
  );
  const clockRuns = makeInMemoryBillingClockRunRepo(runs);
  const layer = Layer.merge(world.layer, clockRuns.layer);
  const fastForward = (until: Date, now: Date, contractId = 'contract-1', maxDays = 60) => {
    world.setClock(until);
    return Effect.runPromiseExit(
      runBillingClock({ contractId, until, actorUserId: 'admin-1', now, maxDays }).pipe(
        Effect.provide(layer)
      )
    );
  };
  const events = (now: Date, contractId = 'contract-1') =>
    Effect.runPromise(loadBillingClockEvents(contractId, now).pipe(Effect.provide(layer)));
  const contract2Cycles = () =>
    world.billingState.cycles.filter((cycle) => cycle.contractId === 'contract-2');
  return { world, clockRuns, layer, fastForward, events, contract2Cycles };
};

describe('the billing fast-forward', () => {
  it('drives one contract hold → capture → transfer and leaves every other contract alone', async () => {
    const t = twoContracts();
    await t.world.step(BEFORE);

    let events = await t.events(BEFORE);
    expect(events[0]).toMatchObject({ kind: 'cycle_hold', at: CYCLE_1.holdAt, cycleNumber: 1 });

    const hold = await t.fastForward(CYCLE_1.holdAt, BEFORE);
    expect(Exit.isSuccess(hold)).toBe(true);
    let [cycle] = await t.world.cycles();
    expect(cycle!.status).toBe('authorised');
    expect(t.contract2Cycles()).toEqual([]);

    events = await t.events(BEFORE);
    const capture = events.find((event) => event.kind === 'cycle_capture')!;
    expect(capture.at).toEqual(CYCLE_1.captureAt);
    expect(Exit.isSuccess(await t.fastForward(capture.at, BEFORE))).toBe(true);
    [cycle] = await t.world.cycles();
    expect(cycle!.status).toBe('captured');

    events = await t.events(BEFORE);
    const transfer = events.find((event) => event.kind === 'cycle_transfer')!;
    expect(transfer.at).toEqual(TRANSFER_1);
    expect(Exit.isSuccess(await t.fastForward(transfer.at, BEFORE))).toBe(true);
    expect(
      t.world.money.state.transfers.filter((row) => row.contractId === 'contract-1')
    ).toHaveLength(1);

    // Contract 2 was never billed: no cycle, no payment.
    expect(t.contract2Cycles()).toEqual([]);
    expect(t.world.billingState.billing.get('contract-2')!.status).toBe('scheduled');

    // Every run is audited, with the event it ran up to.
    const runs = t.clockRuns.state.runs;
    expect(runs.map((run) => [run.eventKind, run.status, run.billingStatusBefore])).toEqual([
      ['cycle_hold', 'succeeded', 'scheduled'],
      ['cycle_capture', 'succeeded', 'scheduled'],
      ['cycle_transfer', 'succeeded', 'active']
    ]);
    expect(runs[0]).toMatchObject({
      contractId: 'contract-1',
      actorUserId: 'admin-1',
      targetAt: CYCLE_1.holdAt,
      billingStatusAfter: 'scheduled',
      error: null
    });
    expect(runs[0]!.eventLabel).toContain('Cycle 1');
    // Structured, so the web names it in the admin's language.
    expect(runs[0]).toMatchObject({ eventCycleNumber: 1, eventDate: '2026-11-02' });
    expect(runs[0]!.finishedAt).not.toBeNull();
  });

  it('runs the worker path over every contract when unscoped', async () => {
    const t = twoContracts();
    const summary = await Effect.runPromise(
      runBillingTickSteps(BEFORE).pipe(Effect.provide(t.layer))
    );
    expect(summary.billing.contracts).toBe(2);
    // The unscoped tick does bill contract 2 — so "contract 2 never moved"
    // above is evidence of the scoping, not of an inert second contract.
    await Effect.runPromise(runBillingTickSteps(CYCLE_1.holdAt).pipe(Effect.provide(t.layer)));
    expect(t.contract2Cycles().length).toBeGreaterThan(0);
    const scoped = await Effect.runPromise(
      runBillingTickSteps(BEFORE, { contractId: 'contract-1' }).pipe(Effect.provide(t.layer))
    );
    expect(scoped.billing.contracts).toBe(1);
  });

  it('records an instant that matches no event without a label', async () => {
    const t = twoContracts();
    await t.world.step(BEFORE);
    const exit = await t.fastForward(new Date('2026-10-26T09:00:00.000Z'), BEFORE);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(t.clockRuns.state.runs[0]).toMatchObject({ eventKind: null, eventLabel: null });
  });

  it('refuses the past, the far future, an unknown contract and a second concurrent run', async () => {
    const t = twoContracts([
      {
        id: 'running',
        contractId: 'contract-1',
        actorUserId: 'admin-2',
        targetAt: CYCLE_1.holdAt,
        eventKind: null,
        eventLabel: null,
        eventCycleNumber: null,
        eventDate: null,
        status: 'running',
        billingStatusBefore: 'scheduled',
        billingStatusAfter: null,
        summary: null,
        error: null,
        startedAt: new Date(BEFORE.getTime() - 60_000),
        finishedAt: null,
        createdAt: BEFORE
      }
    ]);
    expect(refusal(await t.fastForward(BEFORE, BEFORE))).toBe('not_in_future');
    expect(refusal(await t.fastForward(new Date('2026-10-01T00:00:00.000Z'), BEFORE))).toBe(
      'not_in_future'
    );
    expect(refusal(await t.fastForward(new Date(BEFORE.getTime() + 61 * 86_400_000), BEFORE))).toBe(
      'too_far'
    );
    expect(refusal(await t.fastForward(CYCLE_1.holdAt, BEFORE, 'contract-x'))).toBe('not_found');
    expect(refusal(await t.fastForward(CYCLE_1.holdAt, BEFORE))).toBe('already_running');
    // Nothing ran.
    expect(t.world.payments.size).toBe(0);

    // A run left `running` for more than 15 minutes was abandoned.
    const later = new Date(BEFORE.getTime() + 20 * 60_000);
    expect(Exit.isSuccess(await t.fastForward(CYCLE_1.holdAt, later))).toBe(true);
    expect(t.clockRuns.state.runs.find((run) => run.id === 'running')).toMatchObject({
      status: 'failed',
      error: 'abandoned (still running)'
    });
  });

  it('validates the horizon inclusively', () => {
    const now = new Date('2026-11-01T00:00:00.000Z');
    expect(validateBillingClockTarget(new Date(now.getTime() + 60 * 86_400_000), now, 60)).toBe(
      null
    );
    expect(validateBillingClockTarget(new Date(now.getTime() + 1), now, 60)).toBe(null);
    expect(validateBillingClockTarget(now, now, 60)).toBe('not_in_future');
  });
});

describe('scoped tick steps', () => {
  it('confirm only the chosen contract’s unanswered reports', async () => {
    const resolutions = makeInMemorySessionResolutionRepo({
      resolutions: [
        dummySessionResolution({
          id: 'mine',
          contractId: 'contract-1',
          sessionId: 's-1',
          status: 'proposed',
          respondBy: new Date('2026-11-05T21:00:00.000Z')
        }),
        dummySessionResolution({
          id: 'other',
          contractId: 'contract-2',
          sessionId: 's-2',
          status: 'proposed',
          respondBy: new Date('2026-11-05T21:00:00.000Z')
        })
      ]
    });
    const layer = Layer.mergeAll(
      makeIdleContractBillingLayer(),
      Layer.succeed(Payments, makeMockPayments()),
      makeInMemoryContractBillingRepo({ billing: [dummyContractBilling({ status: 'ended' })] })
        .layer,
      Layer.succeed(ContractRepo, {
        findById: () => Effect.succeed(dummyContract)
      } as unknown as Context.Tag.Service<typeof ContractRepo>),
      resolutions.layer
    );
    const summary = await Effect.runPromise(
      runSessionResolutionTick(new Date('2026-11-06T00:00:00.000Z'), {
        contractId: 'contract-1'
      }).pipe(Effect.provide(layer))
    );
    expect(summary.confirmed).toBe(1);
    expect(resolutions.state.resolutions.map((row) => [row.id, row.status]).sort()).toEqual([
      ['mine', 'confirmed'],
      ['other', 'proposed']
    ]);
  });
});

describe('the upcoming events', () => {
  const NOW = new Date('2026-11-01T00:00:00.000Z');
  const cycle = dummyContractCycle;

  it('lists what the tick acts on next, from each source, earliest first', () => {
    const events = billingClockEvents(
      {
        billingStatus: 'active',
        helperReady: true,
        cycles: [
          cycle({
            id: 'c0',
            index: 0,
            status: 'captured',
            transferAt: new Date('2026-11-07T05:00:00.000Z')
          }),
          cycle({
            id: 'c1',
            index: 1,
            startsOn: '2026-11-05',
            endsOn: '2026-11-07',
            status: 'authorised',
            captureAt: new Date('2026-11-05T12:00:00.000Z')
          }),
          cycle({
            id: 'c2',
            index: 2,
            status: 'grace',
            nextRetryAt: new Date('2026-11-07T12:00:00.000Z'),
            startsAt: new Date('2026-11-08T05:00:00.000Z')
          }),
          cycle({
            id: 'c3',
            index: 3,
            status: 'scheduled',
            holdAt: new Date('2026-11-10T05:00:00.000Z')
          }),
          cycle({
            id: 'c4',
            index: 4,
            status: 'capture_failed',
            nextRetryAt: new Date('2026-11-02T00:00:00.000Z')
          }),
          // In flight or done: nothing scheduled.
          cycle({ id: 'c5', index: 5, status: 'authorising' }),
          cycle({ id: 'c6', index: 6, status: 'cancelled' }),
          // Already in the past.
          cycle({
            id: 'c7',
            index: 7,
            status: 'scheduled',
            holdAt: new Date('2026-10-30T00:00:00.000Z')
          })
        ],
        transfers: [
          {
            id: 't1',
            cycleId: 'c1',
            contractId: 'contract-1',
            sequence: 1,
            status: 'due',
            dueAt: new Date('2026-11-03T05:00:00.000Z')
          } as unknown as HelperTransfer
        ],
        resolutions: [
          dummySessionResolution({
            id: 'r1',
            status: 'proposed',
            respondBy: new Date('2026-11-04T00:00:00.000Z')
          }),
          dummySessionResolution({
            id: 'r2',
            kind: 'day_off_agreed',
            status: 'proposed',
            respondBy: new Date('2026-11-04T01:00:00.000Z')
          }),
          dummySessionResolution({ id: 'r3', status: 'confirmed', respondBy: null })
        ],
        extras: [
          {
            id: 'e1',
            date: '2026-11-09',
            status: 'proposed',
            respondBy: new Date('2026-11-02T06:00:00.000Z')
          } as unknown as ExtraSession,
          {
            id: 'e2',
            date: '2026-11-10',
            status: 'agreed',
            chargeAt: new Date('2026-11-02T07:00:00.000Z')
          } as unknown as ExtraSession,
          {
            id: 'e3',
            date: '2026-11-11',
            status: 'charge_failed',
            nextRetryAt: new Date('2026-11-02T08:00:00.000Z')
          } as unknown as ExtraSession
        ],
        disputes: [
          {
            id: 'd1',
            evidenceDueBy: new Date('2026-11-12T00:00:00.000Z'),
            noticesSent: []
          } as unknown as CardDispute,
          {
            id: 'd2',
            evidenceDueBy: new Date('2026-11-12T00:00:00.000Z'),
            noticesSent: ['reminder:2026-11-12T00:00:00.000Z']
          } as unknown as CardDispute
        ],
        evidenceReminderHours: 72
      },
      NOW
    );
    expect(events.map((event) => [event.kind, event.at.toISOString(), event.subjectId])).toEqual([
      ['cycle_capture_retry', '2026-11-02T00:00:00.000Z', 'c4'],
      ['extra_response_deadline', '2026-11-02T06:00:00.000Z', 'e1'],
      ['extra_charge', '2026-11-02T07:00:00.000Z', 'e2'],
      ['extra_charge_retry', '2026-11-02T08:00:00.000Z', 'e3'],
      ['transfer_due', '2026-11-03T05:00:00.000Z', 't1'],
      ['resolution_deadline', '2026-11-04T00:00:00.000Z', 'r1'],
      ['day_off_cutoff', '2026-11-04T01:00:00.000Z', 'r2'],
      ['cycle_capture', '2026-11-05T12:00:00.000Z', 'c1'],
      ['cycle_transfer', '2026-11-07T05:00:00.000Z', 'c0'],
      ['cycle_hold_retry', '2026-11-07T12:00:00.000Z', 'c2'],
      ['cycle_suspension', '2026-11-08T05:00:00.000Z', 'c2'],
      ['dispute_evidence_reminder', '2026-11-09T00:00:00.000Z', 'd1'],
      ['cycle_hold', '2026-11-10T05:00:00.000Z', 'c3']
    ]);
    expect(events.find((event) => event.subjectId === 'c1')).toMatchObject({
      cycleNumber: 2,
      date: '2026-11-05',
      endDate: '2026-11-07',
      label: 'Cycle 2 (2026-11-05 – 2026-11-07): capture'
    });
  });

  it('drops a captured cycle’s transfer once its transfer exists', () => {
    const events = billingClockEvents(
      {
        billingStatus: 'active',
        helperReady: true,
        cycles: [cycle({ id: 'c0', status: 'captured' })],
        transfers: [
          {
            id: 't1',
            cycleId: 'c0',
            sequence: 1,
            status: 'sent',
            dueAt: new Date('2026-11-07T05:00:00.000Z')
          } as unknown as HelperTransfer
        ],
        resolutions: [],
        extras: [],
        disputes: [],
        evidenceReminderHours: 72
      },
      NOW
    );
    expect(events).toEqual([]);
  });
});

describe('the upcoming events, by billing status', () => {
  const NOW = new Date('2026-11-01T00:00:00.000Z');
  const cycle = dummyContractCycle;
  const sources = (billingStatus: 'awaiting_payment_readiness' | 'suspended', ready: boolean) => ({
    billingStatus,
    helperReady: ready,
    cycles: [
      cycle({
        id: 'c0',
        index: 0,
        status: 'scheduled',
        holdAt: new Date('2026-11-02T05:00:00.000Z'),
        startsAt: new Date('2026-11-03T05:00:00.000Z'),
        captureAt: new Date('2026-11-03T12:00:00.000Z')
      }),
      cycle({
        id: 'c1',
        index: 1,
        status: 'scheduled',
        holdAt: new Date('2026-11-09T05:00:00.000Z'),
        startsAt: new Date('2026-11-10T05:00:00.000Z'),
        captureAt: new Date('2026-11-10T12:00:00.000Z')
      })
    ],
    transfers: [],
    resolutions: [],
    extras: [],
    disputes: [],
    evidenceReminderHours: 72
  });

  it('offers no card hold while the helper cannot be paid: only the cancellation', () => {
    const events = billingClockEvents(sources('awaiting_payment_readiness', false), NOW);
    expect(events.map((event) => [event.kind, event.at.toISOString(), event.subjectId])).toEqual([
      ['readiness_cancellation', '2026-11-03T12:00:00.000Z', 'c0']
    ]);
  });

  it('offers the holds once the helper is ready (the tick starts billing then)', () => {
    const events = billingClockEvents(sources('awaiting_payment_readiness', true), NOW);
    expect(events.map((event) => event.kind)).toEqual(['cycle_hold', 'cycle_hold']);
  });

  it('a suspended contract’s scheduled cycles start suspended, never held', () => {
    const events = billingClockEvents(sources('suspended', true), NOW);
    expect(events.map((event) => [event.kind, event.at.toISOString()])).toEqual([
      ['cycle_starts_suspended', '2026-11-03T05:00:00.000Z'],
      ['cycle_starts_suspended', '2026-11-10T05:00:00.000Z']
    ]);
  });

  it('reads the helper’s payout account for a contract awaiting it', async () => {
    const t = twoContracts([], {
      helperReady: false,
      billing: { status: 'awaiting_payment_readiness' }
    });
    await t.world.step(BEFORE);
    expect(t.world.billing().status).toBe('awaiting_payment_readiness');
    const events = await t.events(BEFORE);
    expect(events.map((event) => event.kind)).toEqual(['readiness_cancellation']);
    expect(events[0]!.at).toEqual(CYCLE_1.captureAt);
  });
});
