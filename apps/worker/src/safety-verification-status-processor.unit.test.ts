import { CredibledRequestError, makeCredibledTest } from '@repo/credibled';
import {
  DBNotFoundError,
  makeCheckOrderRepoTest,
  type CheckOrder,
  type CheckOrderCompletionInput,
  type CheckOrderUpdateInput,
  type SafetyVerification
} from '@repo/db';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { reconcileCheckOrderStatuses } from './safety-verification-status-processor';

// The poller is the only recovery path for a dropped Credibled webhook, and
// it shares the webhook's rules: only forward moves, and completing an order
// is what creates the verdict.

const order = (overrides: Partial<CheckOrder> = {}): CheckOrder =>
  ({
    id: 'order-1',
    userId: 'provider-1',
    role: 'service-provider',
    status: 'invited',
    paymentId: 'payment-1',
    credibledCheckUuid: 'check-1',
    applicationUrl: null,
    consentAt: new Date('2026-08-01T00:00:00.000Z'),
    consentPolicyVersion: '2026-08-22',
    orderAttempts: 1,
    lastOrderError: null,
    completedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as CheckOrder;

type Recorded = {
  updates: Array<CheckOrderUpdateInput>;
  completions: Array<CheckOrderCompletionInput>;
};

const record = (): Recorded => ({ updates: [], completions: [] });

const makeLayer = (
  options: {
    inFlight?: Array<CheckOrder>;
    /** What Credibled reports for every check, or 'unreachable'. */
    vendorStatus?: string | 'unreachable';
    completeLosesRace?: boolean;
    advanceLosesRace?: boolean;
    recorded?: Recorded;
  } = {}
) => {
  const recorded = options.recorded ?? record();
  const inFlight = options.inFlight ?? [order()];

  return Layer.mergeAll(
    makeCheckOrderRepoTest({
      findById: () => Effect.fail(new DBNotFoundError({ entity: 'checkOrder', value: '' })),
      findOpen: () => Effect.succeed(null),
      findByCredibledUuid: () => Effect.succeed(null),
      create: () => Effect.die('not used'),
      update: (_id, input) => {
        recorded.updates.push(input);
        return Effect.succeed(order({ ...inFlight[0], ...input } as Partial<CheckOrder>));
      },
      claimForPayment: () => Effect.die('not used'),
      advance: (_id, input) => {
        recorded.updates.push(input.set);
        if (options.advanceLosesRace) return Effect.succeed(null);
        return Effect.succeed(order({ ...inFlight[0], ...input.set } as Partial<CheckOrder>));
      },
      complete: (_id, input) => {
        recorded.completions.push(input);
        if (options.completeLosesRace) return Effect.succeed(null);
        const closed = order({ ...inFlight[0], status: 'complete' } as Partial<CheckOrder>);
        return Effect.succeed({
          order: closed,
          verification: { id: 'sv-1', status: 'review_required' } as SafetyVerification
        });
      },
      listInFlight: () => Effect.succeed(inFlight),
      listAwaitingPlacement: () => Effect.succeed([]),
      listItems: () => Effect.succeed([]),
      addItem: () => Effect.die('not used'),
      removeItem: () => Effect.die('not used')
    }),
    makeCredibledTest({
      getCheckStatus: (_audience, uuid) =>
        options.vendorStatus === 'unreachable'
          ? Effect.fail(
              new CredibledRequestError({
                operation: 'checkStatus',
                status: null,
                cause: 'timeout'
              })
            )
          : Effect.succeed({
              uuid,
              applicationStatus: options.vendorStatus ?? 'Complete',
              checkStatuses: []
            })
    })
  );
};

const run = (layer: ReturnType<typeof makeLayer>) =>
  Effect.runPromise(reconcileCheckOrderStatuses.pipe(Effect.provide(layer)));

describe('reconciling in-flight check orders', () => {
  it('completes a finished check and creates a verdict awaiting review', async () => {
    const recorded = record();
    const summary = await run(makeLayer({ vendorStatus: 'Complete', recorded }));

    expect(summary).toMatchObject({ checked: 1, advanced: 1, unreachable: 0, failed: 0 });
    expect(recorded.completions).toHaveLength(1);
    // The validity window is measured from completion, not from the decision.
    expect(recorded.completions[0]?.verification.issuedOn).toBeTruthy();
    expect(recorded.completions[0]?.verification.expiresOn).toBeTruthy();
    // Never a plain status update for a completion — the verdict must be
    // created in the same transaction.
    expect(recorded.updates).toHaveLength(0);
  });

  it('completes without dates when a person is needed but nothing is finished', async () => {
    const recorded = record();
    await run(makeLayer({ vendorStatus: 'Action Required', recorded }));

    expect(recorded.completions[0]?.verification.issuedOn).toBeNull();
    expect(recorded.completions[0]?.verification.expiresOn).toBeNull();
  });

  it('advances progress without creating a verdict', async () => {
    const recorded = record();
    const summary = await run(makeLayer({ vendorStatus: 'In Progress', recorded }));

    expect(summary.advanced).toBe(1);
    expect(recorded.updates).toEqual([{ status: 'in_progress' }]);
    expect(recorded.completions).toHaveLength(0);
  });

  it('writes nothing when Credibled reports what we already know', async () => {
    const recorded = record();
    const summary = await run(makeLayer({ vendorStatus: 'Waiting On Candidate', recorded }));

    expect(summary.advanced).toBe(0);
    expect(recorded.updates).toHaveLength(0);
    expect(recorded.completions).toHaveLength(0);
  });

  it('does not drag an order the webhook just completed back in flight', async () => {
    const summary = await run(makeLayer({ vendorStatus: 'In Progress', advanceLosesRace: true }));
    expect(summary).toMatchObject({ advanced: 0, failed: 0 });
  });

  it('treats a completion the webhook already applied as unchanged', async () => {
    const summary = await run(makeLayer({ vendorStatus: 'Complete', completeLosesRace: true }));

    expect(summary).toMatchObject({ advanced: 0, failed: 0 });
  });

  it('counts an unreachable vendor without failing the sweep', async () => {
    const recorded = record();
    const summary = await run(makeLayer({ vendorStatus: 'unreachable', recorded }));

    expect(summary).toMatchObject({ checked: 1, advanced: 0, unreachable: 1, failed: 0 });
    expect(recorded.updates).toHaveLength(0);
  });

  it('skips an order that was never placed', async () => {
    // Nothing to ask Credibled about; the worker still owes this one a
    // placement.
    const recorded = record();
    const summary = await run(
      makeLayer({ inFlight: [order({ credibledCheckUuid: null })], recorded })
    );

    expect(summary.advanced).toBe(0);
    expect(recorded.updates).toHaveLength(0);
  });
});
