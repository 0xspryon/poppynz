import { dummyContractCycle, dummySessionResolution, type SessionCharge } from '@repo/db';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { previewSessionActionRouteProgram } from './session-money';
import { recordSessionActionRouteProgram } from './sessions';
import {
  CONTRACT_ID,
  CYCLE_ID,
  HELPER,
  OUTSIDER,
  SESSION_ID,
  failureOf,
  makeContext,
  makeSessionWorld
} from './sessions.test-support';

/**
 * Tier 3 step 2: the money preview before confirming an action, and the
 * action applying the same money at once. The session: Tue 3 Nov 2026,
 * 15:30–17:30 in Toronto, $50.00 of care in a captured cycle (ON family, MB
 * helper): fee $2.50 + HST $0.33 → $52.83; commission $7.50 + GST $0.38.
 */
const params = { id: CONTRACT_ID, sessionId: SESSION_ID };
const LATE = new Date('2026-11-03T15:00:00.000Z'); // 10:00 EST, < 24 h before
const EARLY = new Date('2026-10-30T12:00:00.000Z');

const charge = (): SessionCharge => ({
  sessionId: SESSION_ID,
  cycleId: CYCLE_ID,
  contractId: CONTRACT_ID,
  paymentId: 'payment-1',
  basis: 'session',
  careCents: 5000,
  careTaxLines: [],
  careTaxCents: 0,
  familyFeeCents: 250,
  familyFeeTaxLines: [
    {
      supplyType: 'family_service_fee',
      jurisdiction: 'ON',
      component: 'hst',
      rateMillipercent: 13000,
      baseCents: 250,
      taxCents: 33,
      label: 'HST (ON) 13%',
      registrationNumber: null
    }
  ],
  familyFeeTaxCents: 33,
  familyTotalCents: 5283,
  commissionCents: 750,
  commissionTaxLines: [
    {
      supplyType: 'provider_commission',
      jurisdiction: 'MB',
      component: 'gst',
      rateMillipercent: 5000,
      baseCents: 750,
      taxCents: 38,
      label: 'GST (MB) 5%',
      registrationNumber: null
    }
  ],
  commissionTaxCents: 38,
  helperShareCents: 4212,
  createdAt: new Date('2026-11-02T12:00:00.000Z')
});

const capturedWorld = (options: Parameters<typeof makeSessionWorld>[0] = {}) => {
  const world = makeSessionWorld(options);
  world.billing.state.cycles.push(
    dummyContractCycle({
      id: CYCLE_ID,
      contractId: CONTRACT_ID,
      status: 'captured',
      paymentId: 'payment-1'
    })
  );
  world.billing.state.charges.push(charge());
  return world;
};

const preview = (world: ReturnType<typeof makeSessionWorld>, body: unknown, now: Date) =>
  Effect.runPromiseExit(
    previewSessionActionRouteProgram(makeContext({ params, body }), new Headers(), now).pipe(
      Effect.provide(world.layer)
    )
  );

describe('POST /contracts/:id/sessions/:sessionId/preview', () => {
  it('says what a late cancellation does: Maria receives $12.50, $40.33 back', async () => {
    const exit = await preview(capturedWorld(), { action: 'cancel' }, LATE);
    expect(exit).toMatchObject({
      _tag: 'Success',
      value: {
        preview: {
          outcome: 'family_late',
          charged: true,
          familyBackCents: 5283 - 1250,
          helperReceivesCents: 1250
        }
      }
    });
  });

  it('a timely cancellation gives everything back', async () => {
    const exit = await preview(capturedWorld(), { action: 'cancel' }, EARLY);
    expect(exit).toMatchObject({
      value: { preview: { outcome: 'family_early', familyBackCents: 5283, helperReceivesCents: 0 } }
    });
  });

  it('previews reduced hours from the minutes worked', async () => {
    const exit = await preview(
      capturedWorld({ viewer: HELPER }),
      { action: 'report_reduced_hours', minutesWorked: 60 },
      new Date('2026-11-03T23:00:00.000Z')
    );
    // Half worked: $25.00 paid normally (less its commission), 25 % of $25.00.
    expect(exit).toMatchObject({ value: { preview: { outcome: 'family_late' } } });
    if (exit._tag !== 'Success') throw new Error('expected success');
    expect(exit.value.preview!.helperReceivesCents).toBe(2500 - 375 - 19 + 625);
  });

  it('refuses what the action itself would refuse', async () => {
    const exit = await preview(capturedWorld(), { response: 'accept' }, LATE);
    expect(failureOf(exit)).toMatchObject({
      _tag: 'SessionActionRefusedError',
      reason: 'nothing_to_answer'
    });
  });

  it('needs the session-resolution read permission', async () => {
    const exit = await preview(
      capturedWorld({ grants: ['contract:read'] }),
      { action: 'cancel' },
      LATE
    );
    expect(failureOf(exit)?._tag).toBe('ForbiddenError');
  });

  it('is not found for someone outside the contract', async () => {
    const exit = await preview(capturedWorld({ viewer: OUTSIDER }), { action: 'cancel' }, LATE);
    expect(failureOf(exit)?._tag).toBe('SessionNotFoundError');
  });

  it('answering a report previews it as accepted', async () => {
    const world = capturedWorld({
      resolutions: [
        dummySessionResolution({
          contractId: CONTRACT_ID,
          sessionId: SESSION_ID,
          cycleId: CYCLE_ID,
          kind: 'helper_no_show',
          status: 'proposed',
          reportedByUserId: 'family-1',
          reportedBySide: 'family',
          respondBy: new Date('2026-11-06T00:00:00.000Z')
        })
      ]
    });
    const exit = await preview(
      makeSessionWorldWithViewer(world, HELPER),
      { response: 'accept' },
      new Date('2026-11-04T00:00:00.000Z')
    );
    expect(exit).toMatchObject({
      value: {
        preview: { outcome: 'helper_cancelled', familyBackCents: 5283, helperReceivesCents: 0 }
      }
    });
  });
});

/** The same world, seen by another viewer (shares its repos). */
const makeSessionWorldWithViewer = (
  world: ReturnType<typeof makeSessionWorld>,
  viewer: typeof HELPER
) => {
  const other = makeSessionWorld({ viewer, resolutions: world.resolutions.state.resolutions });
  other.billing.state.cycles.push(...world.billing.state.cycles);
  other.billing.state.charges.push(...world.billing.state.charges);
  return other;
};

describe('recording an action applies its money at once', () => {
  it('a late cancellation on a charged cycle creates the session refund', async () => {
    const world = capturedWorld();
    const exit = await Effect.runPromiseExit(
      recordSessionActionRouteProgram(
        makeContext({ params, body: { action: 'cancel' } }),
        new Headers(),
        LATE
      ).pipe(Effect.provide(world.layer))
    );
    expect(exit._tag).toBe('Success');
    expect(world.money.state.refunds).toEqual([
      expect.objectContaining({ totalCents: 4033, feeCents: 250, status: 'pending' })
    ]);
    expect(world.billing.state.sessions[0]!.status).toBe('cancelled');
  });
});
