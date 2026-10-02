import { describe, expect, it } from 'bun:test';
import {
  BillingCustomerRepo,
  dummyBillingCustomer,
  makeInMemoryBillingCustomerRepo,
  type BillingCustomer
} from '@repo/db';
import { makePaymentsTest, type ProviderCardSetup } from '@repo/payments';
import { Effect, Layer } from 'effect';
import { applyCardSetup, cardOnFile, ensureBillingCustomer } from './cards';

const setup = (overrides: Partial<ProviderCardSetup> = {}): ProviderCardSetup => ({
  reference: 'seti_1',
  status: 'succeeded',
  customer: 'cus_1',
  paymentMethod: { reference: 'pm_new', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 },
  ...overrides
});

const makeWorld = (rows: Array<BillingCustomer>, fetchedSetup = setup()) => {
  const billing = makeInMemoryBillingCustomerRepo(rows);
  const removed: Array<string> = [];
  const created: Array<string> = [];
  const layer = Layer.mergeAll(
    billing.layer,
    makePaymentsTest({
      provider: 'stripe',
      ensureCustomer: ({ userId, existing }) =>
        Effect.sync(() => {
          created.push(userId);
          return existing ?? `cus_${userId}`;
        }),
      getCardSetup: () => Effect.succeed(fetchedSetup),
      removeCard: (reference) => Effect.sync(() => void removed.push(reference))
    })
  );
  return { billing, removed, created, layer };
};

const stripeFamily = (overrides: Partial<BillingCustomer> = {}) =>
  dummyBillingCustomer({ provider: 'stripe', customerReference: 'cus_1', ...overrides });

describe('ensureBillingCustomer', () => {
  it('creates the gateway customer once and records it', async () => {
    const world = makeWorld([]);
    const user = { id: 'family-1', email: 'f@example.com', name: 'Fam' };
    const first = await Effect.runPromise(
      ensureBillingCustomer(user).pipe(Effect.provide(world.layer))
    );
    const second = await Effect.runPromise(
      ensureBillingCustomer(user).pipe(Effect.provide(world.layer))
    );
    expect(first.customerReference).toBe('cus_family-1');
    expect(second.customerReference).toBe('cus_family-1');
    expect(world.created).toEqual(['family-1']);
  });

  it('replaces a customer left by another gateway and forgets its card', async () => {
    const world = makeWorld([dummyBillingCustomer({ provider: 'mock' })]);
    const row = await Effect.runPromise(
      ensureBillingCustomer({ id: 'family-1', email: 'f@example.com', name: 'Fam' }).pipe(
        Effect.provide(world.layer)
      )
    );
    expect(row).toMatchObject({ provider: 'stripe', cardReference: null });
  });
});

describe('cardOnFile', () => {
  it('returns the card saved at the active gateway', async () => {
    const world = makeWorld([stripeFamily()]);
    const card = await Effect.runPromise(cardOnFile('family-1').pipe(Effect.provide(world.layer)));
    expect(card).toEqual({
      reference: 'mock_pm_saved',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2034
    });
  });

  it('ignores a card saved under another gateway', async () => {
    const world = makeWorld([dummyBillingCustomer({ provider: 'mock' })]);
    const card = await Effect.runPromise(cardOnFile('family-1').pipe(Effect.provide(world.layer)));
    expect(card).toBeNull();
  });
});

describe('applyCardSetup', () => {
  it('saves the new card for its owner and detaches the one it replaces', async () => {
    const world = makeWorld([stripeFamily({ cardReference: 'pm_old' })]);
    const result = await Effect.runPromise(
      applyCardSetup('seti_1', 'family-1').pipe(Effect.provide(world.layer))
    );
    expect(result).toMatchObject({ outcome: 'saved', card: { reference: 'pm_new' } });
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_new');
    expect(world.removed).toEqual(['pm_old']);
  });

  it("refuses a setup that belongs to another user's customer", async () => {
    const world = makeWorld([stripeFamily({ userId: 'someone-else' })]);
    const result = await Effect.runPromise(
      applyCardSetup('seti_1', 'family-1').pipe(Effect.provide(world.layer))
    );
    expect(result).toEqual({ outcome: 'not_found' });
    expect(world.billing.rows.get('someone-else')?.cardReference).toBe('mock_pm_saved');
  });

  it('reports an unfinished setup as incomplete and saves nothing', async () => {
    const world = makeWorld([stripeFamily()], setup({ status: 'requires_action' }));
    const result = await Effect.runPromise(
      applyCardSetup('seti_1', 'family-1').pipe(Effect.provide(world.layer))
    );
    expect(result).toEqual({ outcome: 'incomplete' });
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('mock_pm_saved');
  });

  it('fills an empty slot for whichever user owns the customer when called from the webhook', async () => {
    const world = makeWorld([stripeFamily({ cardReference: null })]);
    const result = await Effect.runPromise(
      applyCardSetup('seti_1', null).pipe(Effect.provide(world.layer))
    );
    expect(result.outcome).toBe('saved');
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_new');
  });

  it('re-confirms the card already on file from the webhook without detaching anything', async () => {
    const world = makeWorld([stripeFamily({ cardReference: 'pm_new' })]);
    const result = await Effect.runPromise(
      applyCardSetup('seti_1', null).pipe(Effect.provide(world.layer))
    );
    expect(result).toMatchObject({ outcome: 'saved', card: { reference: 'pm_new' } });
    expect(world.removed).toEqual([]);
  });

  it('never lets a late webhook replace (and detach) a newer card on file', async () => {
    // S1 (card B) is retried by Stripe after the family already replaced B
    // with C in the browser: C must stay on file and attached.
    const world = makeWorld(
      [stripeFamily({ cardReference: 'pm_c' })],
      setup({
        paymentMethod: {
          reference: 'pm_b',
          brand: 'visa',
          last4: '1111',
          expMonth: 1,
          expYear: 2030
        }
      })
    );
    const result = await Effect.runPromise(
      applyCardSetup('seti_1', null).pipe(Effect.provide(world.layer))
    );
    expect(result).toMatchObject({ outcome: 'kept', card: { reference: 'pm_c' } });
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_c');
    expect(world.removed).toEqual([]);
  });

  it('detaches nothing when a concurrent confirm replaced the card first', async () => {
    // This confirm read pm_old, but another tab's confirm put pm_c on file
    // before our write: the compare-and-set loses, and neither card is
    // detached on the strength of the stale read.
    const world = makeWorld([stripeFamily({ cardReference: 'pm_c' })]);
    const inner = Effect.runSync(BillingCustomerRepo.pipe(Effect.provide(world.billing.layer)));
    const stale = stripeFamily({ cardReference: 'pm_old' });
    const layer = Layer.merge(
      world.layer,
      Layer.succeed(BillingCustomerRepo, { ...inner, findByUserId: () => Effect.succeed(stale) })
    );
    const result = await Effect.runPromise(
      applyCardSetup('seti_1', 'family-1').pipe(Effect.provide(layer))
    );
    expect(result.outcome).toBe('kept');
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_c');
    expect(world.removed).toEqual([]);
  });
});
