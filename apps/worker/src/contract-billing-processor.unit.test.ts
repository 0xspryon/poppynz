import { makeIdleContractBillingLayer } from '@repo/billing';
import {
  ContractRepo,
  dummyContract,
  dummyContractBilling,
  dummySessionResolution,
  makeInMemoryContractBillingRepo,
  makeInMemorySessionResolutionRepo
} from '@repo/db';
import { makeMockPayments, Payments } from '@repo/payments';
import { Context, Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { describeTick, processContractBillingTick } from './contract-billing-processor';

describe('processContractBillingTick', () => {
  it('runs the billing tick over every live contract and summarises it', async () => {
    const summary = await Effect.runPromise(
      processContractBillingTick(new Date('2026-11-02T12:00:00.000Z')).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeIdleContractBillingLayer(),
            Layer.succeed(Payments, makeMockPayments())
          )
        )
      )
    );
    expect(summary).toEqual({
      contracts: 0,
      ran: 0,
      failed: 0,
      resolutions: { confirmed: 0, lapsed: 0, failed: 0 }
    });
    expect(describeTick(summary)).toBe(
      'contract billing: 0 ran, 0 failed of 0 live contracts; session resolutions: 0 confirmed, 0 lapsed, 0 failed'
    );
  });

  it('confirms unanswered reports and lapses unconfirmed days off as of the given instant', async () => {
    const resolutions = makeInMemorySessionResolutionRepo({
      resolutions: [
        dummySessionResolution({
          id: 'report',
          sessionId: 's-1',
          status: 'proposed',
          respondBy: new Date('2026-11-05T21:00:00.000Z')
        }),
        dummySessionResolution({
          id: 'day-off',
          sessionId: 's-2',
          kind: 'day_off_agreed',
          status: 'proposed',
          respondBy: new Date('2026-11-02T20:30:00.000Z')
        })
      ]
    });
    const layer = Layer.mergeAll(
      makeIdleContractBillingLayer(),
      Layer.succeed(Payments, makeMockPayments()),
      // No live billing to run; the contract exists for the notices.
      makeInMemoryContractBillingRepo({
        billing: [dummyContractBilling({ status: 'ended' })]
      }).layer,
      Layer.succeed(ContractRepo, {
        findById: () => Effect.succeed(dummyContract)
      } as unknown as Context.Tag.Service<typeof ContractRepo>),
      resolutions.layer
    );
    const before = await Effect.runPromise(
      processContractBillingTick(new Date('2026-11-02T20:29:00.000Z')).pipe(Effect.provide(layer))
    );
    expect(before.resolutions).toEqual({ confirmed: 0, lapsed: 0, failed: 0 });
    const asOf = await Effect.runPromise(
      processContractBillingTick(new Date('2026-11-05T21:00:00.000Z')).pipe(Effect.provide(layer))
    );
    expect(asOf.resolutions).toEqual({ confirmed: 1, lapsed: 1, failed: 0 });
    expect(resolutions.state.resolutions.map((row) => [row.id, row.status])).toEqual([
      ['report', 'confirmed'],
      ['day-off', 'lapsed']
    ]);
  });
});
