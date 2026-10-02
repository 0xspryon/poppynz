import { describe, expect, it } from 'bun:test';
import {
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

  it('applies for whichever user owns the customer when called from the webhook', async () => {
    const world = makeWorld([stripeFamily()]);
    const result = await Effect.runPromise(
      applyCardSetup('seti_1', null).pipe(Effect.provide(world.layer))
    );
    expect(result.outcome).toBe('saved');
  });
});
