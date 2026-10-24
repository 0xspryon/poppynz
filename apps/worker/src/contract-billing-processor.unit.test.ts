import { makeIdleContractBillingLayer } from '@repo/billing';
import { makeMockPayments, Payments } from '@repo/payments';
import { Effect, Layer } from 'effect';
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
    expect(summary).toEqual({ contracts: 0, ran: 0, failed: 0 });
    expect(describeTick(summary)).toBe('contract billing: 0 ran, 0 failed of 0 live contracts');
  });
});
