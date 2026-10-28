import { describe, expect, it } from 'bun:test';
import { Effect, Either } from 'effect';
import { makeInMemoryContractBillingRepo, type SessionCharge } from './contract-billing-repo';
import { makeInMemorySessionMoneyRepo, type SessionRefundInsert } from './session-money-repo';

const charge = (overrides: Partial<SessionCharge> = {}): SessionCharge => ({
  sessionId: 's-1',
  cycleId: 'c-1',
  contractId: 'k-1',
  paymentId: 'p-1',
  basis: 'session',
  careCents: 6250,
  careTaxLines: [],
  careTaxCents: 0,
  familyFeeCents: 312,
  familyFeeTaxLines: [],
  familyFeeTaxCents: 40,
  familyTotalCents: 6602,
  commissionCents: 937,
  commissionTaxLines: [],
  commissionTaxCents: 47,
  helperShareCents: 5266,
  createdAt: new Date(),
  ...overrides
});

const refund = (key: string, totalCents: number, sessionId = 's-1'): SessionRefundInsert => ({
  refundKey: key,
  sessionId,
  resolutionId: 'r-1',
  cycleId: 'c-1',
  contractId: 'k-1',
  paymentId: 'p-1',
  careCents: totalCents,
  careTaxLines: [],
  careTaxCents: 0,
  feeCents: 0,
  feeTaxLines: [],
  feeTaxCents: 0,
  totalCents
});

const effect = (sessionId = 's-1') => ({
  sessionId,
  contractId: 'k-1',
  cycleId: 'c-1',
  outcome: 'family_late',
  mechanism: 'refund',
  signature: 'x',
  appliedAt: new Date()
});

const setup = (captured = 10_000) => {
  const billing = makeInMemoryContractBillingRepo();
  billing.state.charges.push(charge(), charge({ sessionId: 's-2', familyTotalCents: 6602 }));
  return makeInMemorySessionMoneyRepo({ billing: billing.state, capturedOf: () => captured });
};

describe('in-memory SessionMoneyRepo', () => {
  it('applies a refund once per key (a double click, a retry)', async () => {
    const repo = setup();
    const first = await Effect.runPromise(
      repo.service.applyEffect({
        effect: effect(),
        refund: refund('r-1:late', 5039),
        recovery: null,
        ledger: []
      })
    );
    const again = await Effect.runPromise(
      repo.service.applyEffect({
        effect: effect(),
        refund: refund('r-1:late', 5039),
        recovery: null,
        ledger: []
      })
    );
    expect(first.refundCreated).toBe(true);
    expect(again.refundCreated).toBe(false);
    expect(again.refund?.id).toBe(first.refund!.id);
    expect(repo.state.refunds).toHaveLength(1);
  });

  it('refuses refunds above the session’s frozen total or the payment’s capture', async () => {
    const repo = setup(8000);
    await Effect.runPromise(
      repo.service.applyEffect({
        effect: effect(),
        refund: refund('a', 5039),
        recovery: null,
        ledger: []
      })
    );
    const overSession = await Effect.runPromise(
      Effect.either(
        repo.service.applyEffect({
          effect: effect(),
          refund: refund('b', 1564),
          recovery: null,
          ledger: []
        })
      )
    );
    expect(Either.isLeft(overSession) && overSession.left._tag).toBe('RefundLimitError');
    const overPayment = await Effect.runPromise(
      Effect.either(
        repo.service.applyEffect({
          effect: effect('s-2'),
          refund: refund('c', 3000, 's-2'),
          recovery: null,
          ledger: []
        })
      )
    );
    expect(Either.isLeft(overPayment) && overPayment.left.detail).toContain('captured');
  });
});
