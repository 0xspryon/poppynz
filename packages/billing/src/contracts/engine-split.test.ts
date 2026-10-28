import { describe, expect, it } from 'bun:test';
import { ContractBillingRepo } from '@repo/db';
import { Effect } from 'effect';
import { at, CYCLE_1, FAMILY_TOTAL, makeWorld } from './test-world';

/** Tier 3 step 2: the engine freezes the per-session split at capture and
 * charges what the sessions' money state says (spec §5, §7). */
const BEFORE = new Date('2026-10-25T12:00:00.000Z');

const setSession = (
  world: ReturnType<typeof makeWorld>,
  date: string,
  status: 'cancelled' | 'disputed' | 'scheduled',
  compensationCents = 0
) => {
  const session = world.sessions().find((row) => row.date === date)!;
  return world.run(
    ContractBillingRepo.pipe(
      Effect.flatMap((repo) =>
        repo.setSessionMoneyState(session.id, {
          from: ['scheduled', 'completed', 'cancelled', 'disputed'],
          status,
          compensationCents
        })
      ),
      Effect.provide(world.layer)
    )
  );
};

describe('the frozen split at capture', () => {
  it('writes the §5 worked example in the capture', async () => {
    const world = makeWorld();
    await world.step(BEFORE);
    await world.step(at(CYCLE_1.holdAt, 5));
    await world.step(at(CYCLE_1.captureAt, 1));
    const charges = world.billingState.charges;
    expect(
      charges.map((c) => [
        c.familyFeeCents,
        c.familyFeeTaxCents,
        c.familyTotalCents,
        c.commissionCents,
        c.helperShareCents
      ])
    ).toEqual([
      [313, 41, 6604, 938, 5265],
      [312, 40, 6602, 937, 5266]
    ]);
    expect(charges.reduce((t, c) => t + c.familyTotalCents, 0)).toBe(FAMILY_TOTAL);
    const [cycle] = await world.cycles();
    expect(cycle!.chargedSessions.map((s) => s.valueCents)).toEqual([6250, 6250]);
    // A rerun writes nothing twice.
    await world.step(at(CYCLE_1.captureAt, 20));
    expect(world.billingState.charges).toHaveLength(2);
  });

  it('leaves a session cancelled before the hold out of the plan', async () => {
    const world = makeWorld();
    await world.step(BEFORE);
    await setSession(world, '2026-11-04', 'cancelled');
    await world.step(at(CYCLE_1.holdAt, 5));
    const [cycle] = await world.cycles();
    expect(cycle).toMatchObject({ serviceCents: 6250, familyTotalCents: 6250 + 313 + 41 });
  });

  it('reduces the capture for a session cancelled after the hold', async () => {
    const world = makeWorld();
    await world.step(BEFORE);
    await world.step(at(CYCLE_1.holdAt, 5));
    await setSession(world, '2026-11-04', 'cancelled');
    await world.step(at(CYCLE_1.captureAt, 1));
    const [cycle] = await world.cycles();
    // One session: fee 3.13 (half up), HST 0.41.
    expect(cycle).toMatchObject({
      status: 'captured',
      heldCents: FAMILY_TOTAL,
      capturedCents: 6604
    });
    expect(world.billingState.charges.map((c) => c.familyTotalCents)).toEqual([6604]);
  });

  it('charges only the compensation of a late cancellation before the capture', async () => {
    const world = makeWorld();
    await world.step(BEFORE);
    await world.step(at(CYCLE_1.holdAt, 5));
    await setSession(world, '2026-11-02', 'cancelled', 1563);
    await world.step(at(CYCLE_1.captureAt, 1));
    const [cycle] = await world.cycles();
    expect(cycle).toMatchObject({ compensationCents: 1563, capturedCents: 6604 + 1563 });
    expect(cycle!.providerShareCents).toBe(5265 + 1563);
    const compensation = world.billingState.charges.find((c) => c.basis === 'compensation')!;
    expect(compensation).toMatchObject({
      careCents: 1563,
      familyFeeCents: 0,
      helperShareCents: 1563
    });
    const payment = [...world.payments.values()][0]!;
    expect(payment).toMatchObject({ amountCents: 6250 + 1563, capturedCents: 8167 });
  });

  it('still charges a disputed session (its pay is held back, not its charge)', async () => {
    const world = makeWorld();
    await world.step(BEFORE);
    await world.step(at(CYCLE_1.holdAt, 5));
    await setSession(world, '2026-11-04', 'disputed');
    await world.step(at(CYCLE_1.captureAt, 1));
    expect((await world.cycles())[0]).toMatchObject({ capturedCents: FAMILY_TOTAL });
    expect(world.billingState.charges).toHaveLength(2);
  });
});
