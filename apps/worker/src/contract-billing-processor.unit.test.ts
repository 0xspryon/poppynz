import { makeIdleContractBillingLayer } from '@repo/billing';
import {
  ContractRepo,
  dummyContract,
  dummyContractBilling,
  dummySessionResolution,
  makeInMemoryCardDisputeRepo,
  makeInMemoryContractBillingRepo,
  makeInMemorySessionResolutionRepo
} from '@repo/db';
import { makeMailerTest } from '@repo/mail';
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
      resolutions: { confirmed: 0, lapsed: 0, failed: 0 },
      money: { reconciled: 0, refundsSent: 0, transfers: 0, failed: 0 }
    });
    expect(describeTick(summary)).toBe(
      'contract billing: 0 ran, 0 failed of 0 live contracts; session resolutions: 0 confirmed, 0 lapsed, 0 failed; money: 0 sessions applied, 0 refunds sent, 0 transfers processed, 0 failed'
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

describe('card dispute evidence reminders (Tier 3 step 4)', () => {
  it('reminds the admins once, 72 h before the evidence is due', async () => {
    const disputes = makeInMemoryCardDisputeRepo();
    Effect.runSync(
      disputes.service.ensure({
        dispute: {
          provider: 'mock',
          providerReference: 'mock_du_1',
          paymentId: 'payment-1',
          familyUserId: 'family-1',
          scope: 'payment',
          amountCents: 13206,
          currency: 'cad',
          reason: 'fraudulent',
          status: 'needs_response',
          evidenceDueBy: new Date('2026-11-10T23:59:59.000Z'),
          providerCreatedAt: new Date('2026-11-02T00:00:00.000Z'),
          syncedAt: new Date('2026-11-02T00:00:00.000Z')
        },
        sessions: []
      })
    );
    const alerts: Array<string> = [];
    const layer = Layer.mergeAll(
      makeIdleContractBillingLayer(),
      Layer.succeed(Payments, makeMockPayments()),
      disputes.layer,
      makeMailerTest({
        sendAdminBillingAlert: (mail) => Effect.sync(() => void alerts.push(mail.subject))
      })
    );
    const tick = (at: string) =>
      Effect.runPromise(processContractBillingTick(new Date(at)).pipe(Effect.provide(layer)));
    await tick('2026-11-07T12:00:00.000Z');
    expect(alerts).toEqual([]);
    await tick('2026-11-08T00:00:00.000Z');
    await tick('2026-11-08T00:15:00.000Z');
    expect(alerts).toEqual(['Card dispute evidence due in 72 h: $132.06 CAD (mock_du_1)']);
  });
});
