import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import {
  dummySessionResolution,
  makeInMemorySessionResolutionRepo,
  type SessionResolutionInsert
} from './session-resolution-repo';

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

const insert = (overrides: Partial<SessionResolutionInsert> = {}): SessionResolutionInsert => ({
  contractId: 'contract-1',
  sessionId: 'session-1',
  cycleId: 'cycle-1',
  kind: 'helper_cancelled',
  reportedByUserId: 'provider-1',
  reportedBySide: 'helper',
  recordedAt: new Date('2026-11-01T12:00:00.000Z'),
  status: 'confirmed',
  ...overrides
});

const audit = { actorUserId: 'provider-1', actorSide: 'helper' as const, action: 'recorded' };

describe('in-memory SessionResolutionRepo', () => {
  it('records one active resolution per session, with its audit row', async () => {
    const { service, state } = makeInMemorySessionResolutionRepo();
    const first = await run(service.record(insert(), audit));
    const second = await run(service.record(insert({ kind: 'family_cancelled_late' }), audit));
    expect(first?.kind).toBe('helper_cancelled');
    expect(second).toBeNull();
    expect(state.events.map((row) => [row.action, row.fromStatus, row.toStatus])).toEqual([
      ['recorded', null, 'confirmed']
    ]);
  });

  it('frees the session once its resolution lapsed or was reversed', async () => {
    const { service } = makeInMemorySessionResolutionRepo({
      resolutions: [dummySessionResolution({ sessionId: 'session-1', status: 'lapsed' })]
    });
    expect(await run(service.findActiveForSession('session-1'))).toBeNull();
    expect(await run(service.record(insert(), audit))).not.toBeNull();
  });

  it('advances by compare-and-set and audits before and after', async () => {
    const { service, state } = makeInMemorySessionResolutionRepo({
      resolutions: [dummySessionResolution({ id: 'r-1', status: 'proposed' })]
    });
    const moved = await run(
      service.advance(
        'r-1',
        { from: ['proposed'], set: { status: 'contested', responseNote: 'I was there' } },
        { actorUserId: 'provider-1', actorSide: 'helper', action: 'contested' }
      )
    );
    const lost = await run(
      service.advance(
        'r-1',
        { from: ['proposed'], set: { status: 'confirmed' } },
        { actorUserId: null, actorSide: 'system', action: 'confirmed_by_silence' }
      )
    );
    expect(moved?.status).toBe('contested');
    expect(lost).toBeNull();
    const [event] = state.events;
    expect(event?.before).toMatchObject({ status: 'proposed', responseNote: null });
    expect(event?.after).toMatchObject({ status: 'contested', responseNote: 'I was there' });
    expect(state.events).toHaveLength(1);
  });

  it('lists the proposals whose response deadline has passed', async () => {
    const { service } = makeInMemorySessionResolutionRepo({
      resolutions: [
        dummySessionResolution({
          id: 'due',
          sessionId: 's-1',
          respondBy: new Date('2026-11-05T12:00:00.000Z')
        }),
        dummySessionResolution({
          id: 'later',
          sessionId: 's-2',
          respondBy: new Date('2026-11-06T12:00:00.000Z')
        }),
        dummySessionResolution({
          id: 'answered',
          sessionId: 's-3',
          status: 'confirmed',
          respondBy: new Date('2026-11-04T12:00:00.000Z')
        })
      ]
    });
    const due = await run(service.listDue(new Date('2026-11-05T12:00:00.000Z')));
    expect(due.map((row) => row.id)).toEqual(['due']);
  });
});
