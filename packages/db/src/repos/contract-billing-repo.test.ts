import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import {
  dummyContractBilling,
  dummyContractCycle,
  makeInMemoryContractBillingRepo
} from './contract-billing-repo';

describe('in-memory ContractBillingRepo', () => {
  it('appends a notice once, never overwriting notices recorded meanwhile', async () => {
    const { service, state } = makeInMemoryContractBillingRepo();
    state.cycles.push(dummyContractCycle({ id: 'cycle-1', noticesSent: ['quote_failed'] }));
    const first = await Effect.runPromise(service.appendCycleNotice('cycle-1', 'hold_declined'));
    const again = await Effect.runPromise(service.appendCycleNotice('cycle-1', 'hold_declined'));
    expect(first?.noticesSent).toEqual(['quote_failed', 'hold_declined']);
    expect(again).toBeNull();
  });

  it('guards a claim on the attempt counter', async () => {
    const { service, state } = makeInMemoryContractBillingRepo();
    state.cycles.push(dummyContractCycle({ id: 'cycle-1', status: 'grace', attempts: 2 }));
    const stale = await Effect.runPromise(
      service.advanceCycle('cycle-1', { from: ['grace'], attempts: 1, set: { attempts: 2 } })
    );
    const fresh = await Effect.runPromise(
      service.advanceCycle('cycle-1', { from: ['grace'], attempts: 2, set: { attempts: 3 } })
    );
    expect(stale).toBeNull();
    expect(fresh?.attempts).toBe(3);
  });

  it('claims the family retry once per interval, so a double click starts one retry', async () => {
    const { service } = makeInMemoryContractBillingRepo({
      billing: [dummyContractBilling({ contractId: 'contract-1' })]
    });
    const now = new Date('2026-11-01T12:00:00.000Z');
    const minuteAgo = new Date(now.getTime() - 60_000);
    const first = await Effect.runPromise(service.claimFamilyRetry('contract-1', now, minuteAgo));
    const second = await Effect.runPromise(service.claimFamilyRetry('contract-1', now, minuteAgo));
    expect(first?.familyRetryAt).toEqual(now);
    expect(second).toBeNull();

    const later = new Date(now.getTime() + 60_000);
    const third = await Effect.runPromise(service.claimFamilyRetry('contract-1', later, now));
    expect(third?.familyRetryAt).toEqual(later);
    expect(
      await Effect.runPromise(service.claimFamilyRetry('missing', later, now))
    ).toBeNull();
  });
});
