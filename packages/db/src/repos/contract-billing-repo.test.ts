import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { dummyContractCycle, makeInMemoryContractBillingRepo } from './contract-billing-repo';

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
});
