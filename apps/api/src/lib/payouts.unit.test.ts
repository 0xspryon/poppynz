import { SqlError } from '@effect/sql/SqlError';
import {
  dummyPayoutAccount,
  makeInMemoryPayoutAccountRepo,
  makePayoutAccountRepoTest,
  type AppliedPayoutSnapshot
} from '@repo/db';
import { makePaymentsTest, PaymentProviderError } from '@repo/payments';
import { Effect, Exit, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  derivePayoutStatus,
  handleAccountUpdated,
  hasReadyPayoutAccount,
  isPaymentReady,
  isStale,
  mapPayoutsProviderError,
  refreshPayoutAccount,
  requirementLabels
} from './payouts';
import { readySnapshot } from './payouts.test-support';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

/** A Stripe-backed Payments (dummyPayoutAccount rows are `provider: 'stripe'`). */
const paymentsReturning = (
  fetched: Array<string>,
  snapshot = readySnapshot(),
  fail = false
) =>
  makePaymentsTest({
    provider: 'stripe',
    getPayoutAccount: (reference) => {
      fetched.push(reference);
      return fail
        ? Effect.fail(new PaymentProviderError({ operation: 'getPayoutAccount', cause: 'down' }))
        : Effect.succeed(snapshot);
    }
  });

describe('derivePayoutStatus', () => {
  it('is ready only when all three flags are true', () => {
    expect(derivePayoutStatus(readySnapshot())).toBe('ready');
    expect(derivePayoutStatus(readySnapshot({ transfersActive: false }))).toBe('restricted');
    expect(derivePayoutStatus(readySnapshot({ payoutsEnabled: false }))).toBe('restricted');
  });

  it('is disabled when Stripe rejected the account', () => {
    expect(
      derivePayoutStatus(
        readySnapshot({
          detailsSubmitted: true,
          payoutsEnabled: false,
          transfersActive: false,
          disabledReason: 'rejected.fraud'
        })
      )
    ).toBe('disabled');
  });

  it('is restricted when details are in but Stripe still needs something', () => {
    expect(
      derivePayoutStatus(
        readySnapshot({
          payoutsEnabled: false,
          requirementsDue: ['external_account'],
          disabledReason: 'requirements.past_due'
        })
      )
    ).toBe('restricted');
  });

  it('is onboarding before details are submitted', () => {
    expect(
      derivePayoutStatus({
        detailsSubmitted: false,
        payoutsEnabled: false,
        transfersActive: false,
        requirementsDue: ['individual.dob.day'],
        disabledReason: 'requirements.past_due'
      })
    ).toBe('onboarding');
  });
});

describe('isStale', () => {
  it('re-fetches a never-fetched or older-than-the-window snapshot only', () => {
    const now = new Date();
    expect(isStale({ refreshedAt: null }, now, 60)).toBe(true);
    expect(isStale({ refreshedAt: minutesAgo(61) }, now, 60)).toBe(true);
    expect(isStale({ refreshedAt: minutesAgo(30) }, now, 60)).toBe(false);
  });
});

describe('requirementLabels', () => {
  it('turns Stripe codes into deduplicated, human-readable labels', () => {
    expect(
      requirementLabels([
        'external_account',
        'individual.dob.day',
        'individual.dob.month',
        'individual.verification.document',
        'tos_acceptance.date',
        'something.new'
      ])
    ).toEqual([
      'A bank account for your payouts',
      'Date of birth',
      'Photo ID',
      "Accept Stripe's terms of service",
      'Other details Stripe needs'
    ]);
  });
});

describe('isPaymentReady', () => {
  it('is false without a payout account', async () => {
    const { layer } = makeInMemoryPayoutAccountRepo();
    const ready = await Effect.runPromise(
      isPaymentReady('helper-1').pipe(Effect.provide(Layer.merge(layer, paymentsReturning([]))))
    );
    expect(ready).toBe(false);
  });

  it('uses a fresh stored snapshot without calling the provider', async () => {
    const fetched: Array<string> = [];
    const { layer } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({ status: 'ready', refreshedAt: minutesAgo(5) })
    ]);
    const ready = await Effect.runPromise(
      isPaymentReady('helper-1').pipe(Effect.provide(Layer.merge(layer, paymentsReturning(fetched))))
    );
    expect(ready).toBe(true);
    expect(fetched).toEqual([]);
  });

  it('re-fetches a stale snapshot and stores it', async () => {
    const fetched: Array<string> = [];
    const applied: Array<AppliedPayoutSnapshot> = [];
    const { layer } = makeInMemoryPayoutAccountRepo(
      [dummyPayoutAccount({ status: 'onboarding', refreshedAt: minutesAgo(90) })],
      applied
    );
    const ready = await Effect.runPromise(
      isPaymentReady('helper-1').pipe(Effect.provide(Layer.merge(layer, paymentsReturning(fetched))))
    );
    expect(ready).toBe(true);
    expect(fetched).toEqual(['acct_123']);
    expect(applied[0].snapshot).toMatchObject({ status: 'ready', transfersActive: true });
  });

  it('keeps the stored answer when the provider is down', async () => {
    const { layer } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({ status: 'restricted', refreshedAt: minutesAgo(90) })
    ]);
    const ready = await Effect.runPromise(
      isPaymentReady('helper-1').pipe(
        Effect.provide(Layer.merge(layer, paymentsReturning([], readySnapshot(), true)))
      )
    );
    expect(ready).toBe(false);
  });

  it('answers false for a stale stored ready when Stripe cannot confirm it', async () => {
    // Stripe may have restricted the account since; an unconfirmed `ready`
    // must never move money.
    const fetched: Array<string> = [];
    const { layer } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({ status: 'ready', refreshedAt: minutesAgo(90 * 24) })
    ]);
    const ready = await Effect.runPromise(
      isPaymentReady('helper-1').pipe(
        Effect.provide(Layer.merge(layer, paymentsReturning(fetched, readySnapshot(), true)))
      )
    );
    expect(ready).toBe(false);
    expect(fetched).toEqual(['acct_123']);
  });

  it('answers false for a stale stored ready when the account vanished during the refresh', async () => {
    const { layer, rows } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({ status: 'ready', refreshedAt: minutesAgo(90) })
    ]);
    const vanishing = makePaymentsTest({
      provider: 'stripe',
      getPayoutAccount: () =>
        Effect.sync(() => {
          rows.delete('helper-1');
          return readySnapshot();
        })
    });
    const ready = await Effect.runPromise(
      isPaymentReady('helper-1').pipe(Effect.provide(Layer.merge(layer, vanishing)))
    );
    expect(ready).toBe(false);
  });

  it('answers false when the database fails', async () => {
    const failing = makePayoutAccountRepoTest({
      findByUserId: () => Effect.fail(new SqlError({ cause: 'db down' })),
      findByReference: () => Effect.die('not used'),
      create: () => Effect.die('not used'),
      applySnapshot: () => Effect.die('not used')
    });
    const ready = await Effect.runPromise(
      isPaymentReady('helper-1').pipe(Effect.provide(Layer.merge(failing, paymentsReturning([]))))
    );
    expect(ready).toBe(false);
  });
});

describe('hasReadyPayoutAccount', () => {
  it('reads the stored status only', async () => {
    const fetched: Array<string> = [];
    const { layer } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({ status: 'ready', refreshedAt: minutesAgo(600) })
    ]);
    const provided = Layer.merge(layer, paymentsReturning(fetched));
    expect(
      await Effect.runPromise(hasReadyPayoutAccount('helper-1').pipe(Effect.provide(provided)))
    ).toBe(true);
    expect(
      await Effect.runPromise(hasReadyPayoutAccount('nobody').pipe(Effect.provide(provided)))
    ).toBe(false);
    expect(fetched).toEqual([]);
  });

  it("ignores an account from another provider (2a's mock → stripe rule)", async () => {
    const { layer } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({
        provider: 'mock',
        accountReference: 'mock_acct_helper-1',
        status: 'ready'
      })
    ]);
    expect(
      await Effect.runPromise(
        hasReadyPayoutAccount('helper-1').pipe(
          Effect.provide(Layer.merge(layer, paymentsReturning([])))
        )
      )
    ).toBe(false);
  });
});

describe('handleAccountUpdated', () => {
  it('re-fetches and stores the snapshot of a known account', async () => {
    const fetched: Array<string> = [];
    const applied: Array<AppliedPayoutSnapshot> = [];
    const { layer, rows } = makeInMemoryPayoutAccountRepo([dummyPayoutAccount()], applied);
    const outcome = await Effect.runPromise(
      handleAccountUpdated('acct_123').pipe(
        Effect.provide(Layer.merge(layer, paymentsReturning(fetched)))
      )
    );
    expect(outcome).toBe('applied');
    expect(fetched).toEqual(['acct_123']);
    expect(rows.get('helper-1')?.status).toBe('ready');
  });

  it('ignores an account Poppynz does not know', async () => {
    const fetched: Array<string> = [];
    const { layer } = makeInMemoryPayoutAccountRepo([dummyPayoutAccount()]);
    const outcome = await Effect.runPromise(
      handleAccountUpdated('acct_unknown').pipe(
        Effect.provide(Layer.merge(layer, paymentsReturning(fetched)))
      )
    );
    expect(outcome).toBe('unknown_account');
    expect(fetched).toEqual([]);
  });

  it('is safe to apply twice (a redelivered event lands on the same state)', async () => {
    const applied: Array<AppliedPayoutSnapshot> = [];
    const { layer, rows } = makeInMemoryPayoutAccountRepo([dummyPayoutAccount()], applied);
    const provided = Layer.merge(layer, paymentsReturning([]));
    await Effect.runPromise(handleAccountUpdated('acct_123').pipe(Effect.provide(provided)));
    const once = rows.get('helper-1');
    await Effect.runPromise(handleAccountUpdated('acct_123').pipe(Effect.provide(provided)));
    expect(rows.get('helper-1')?.status).toBe(once?.status);
    expect(applied.map((entry) => entry.snapshot.status)).toEqual(['ready', 'ready']);
  });

  it('fails with PayoutsProviderError so the webhook answers 500 and Stripe retries', async () => {
    const { layer } = makeInMemoryPayoutAccountRepo([dummyPayoutAccount()]);
    const exit = await Effect.runPromiseExit(
      handleAccountUpdated('acct_123').pipe(
        Effect.provide(Layer.merge(layer, paymentsReturning([], readySnapshot(), true)))
      )
    );
    expect(JSON.stringify(exit)).toContain('PayoutsProviderError');
  });
});

describe('refreshPayoutAccount', () => {
  it('never lets a refresh that finishes late overwrite a newer snapshot', async () => {
    // GET /payouts starts fetching (Stripe still says ready); meanwhile the
    // webhook's re-fetch stores `restricted`. The GET's write lands last.
    const { layer, rows } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({ status: 'ready', refreshedAt: minutesAgo(90) })
    ]);
    const slow = makePaymentsTest({
      provider: 'stripe',
      getPayoutAccount: () =>
        Effect.gen(function* () {
          yield* Effect.sleep('5 millis');
          const row = rows.get('helper-1')!;
          rows.set('helper-1', { ...row, status: 'restricted', refreshedAt: new Date() });
          yield* Effect.sleep('5 millis');
          return readySnapshot();
        })
    });
    const result = await Effect.runPromise(
      refreshPayoutAccount(rows.get('helper-1')!).pipe(Effect.provide(Layer.merge(layer, slow)))
    );
    expect(rows.get('helper-1')?.status).toBe('restricted');
    // The caller sees the newer stored snapshot, not its own stale input.
    expect(result.status).toBe('restricted');
  });
});

describe('mapPayoutsProviderError', () => {
  it('logs the operation and the provider error message/type server-side (e2e bug B1)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = Effect.fail(
      new PaymentProviderError({
        operation: 'createDashboardLink',
        cause: {
          message: 'Cannot create a login link for a Standard or Custom account not connected to it.',
          type: 'invalid_request_error'
        }
      })
    ).pipe((errors) => mapPayoutsProviderError(errors));

    const exit = await Effect.runPromiseExit(program);

    expect(Exit.isFailure(exit)).toBe(true);
    const logged = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('level=ERROR');
    expect(logged).toContain('createDashboardLink');
    expect(logged).toContain('Cannot create a login link');
    expect(logged).toContain('invalid_request_error');
  });

  it('falls back to String(cause) when the provider error has no message', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = Effect.fail(
      new PaymentProviderError({ operation: 'getPayoutAccount', cause: 'stripe down' })
    ).pipe((errors) => mapPayoutsProviderError(errors));

    await Effect.runPromiseExit(program);

    const logged = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('getPayoutAccount');
    expect(logged).toContain('stripe down');
  });
});
