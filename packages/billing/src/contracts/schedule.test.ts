import { describe, expect, it } from 'bun:test';
import {
  firstSessionStart,
  planCycle,
  planSessions,
  planWindow,
  type ScheduleTerms
} from './schedule';

// 2026-11-01 is the fall-back night in America/Toronto (02:00 EDT → 01:00 EST).
const terms = (overrides: Partial<ScheduleTerms> = {}): ScheduleTerms => ({
  services: [
    {
      serviceId: 'svc-care',
      name: 'Childcare',
      rateCents: 2500,
      sessions: [
        // Sunday 01:00–05:00 (crosses the fall-back), Monday 15:30–18:00.
        { weekday: 6, startMinutes: 60, endMinutes: 300 },
        { weekday: 0, startMinutes: 930, endMinutes: 1080 }
      ]
    }
  ],
  startsOn: '2026-10-31',
  timeZone: 'America/Toronto',
  endsOn: null,
  endsAtMinutes: null,
  ...overrides
});

describe('planSessions', () => {
  it('materialises each weekday of the pattern with real elapsed minutes', () => {
    const sessions = planSessions(terms(), '2026-10-31', '2026-11-02');
    expect(sessions.map((s) => [s.date, s.slot, s.elapsedMinutes, s.valueCents])).toEqual([
      ['2026-11-01', 'svc-care@60', 300, 12500], // 4 wall hours, 5 real hours
      ['2026-11-02', 'svc-care@930', 150, 6250]
    ]);
    expect(sessions[0]!.startsAt.toISOString()).toBe('2026-11-01T05:00:00.000Z'); // 01:00 EDT
    expect(sessions[0]!.endsAt.toISOString()).toBe('2026-11-01T10:00:00.000Z'); // 05:00 EST
  });

  it('cuts the last day at its end time and drops sessions after it', () => {
    const cut = planSessions(
      terms({ endsOn: '2026-11-02', endsAtMinutes: 1020 }),
      '2026-11-02',
      '2026-11-30'
    );
    expect(cut.map((s) => [s.date, s.endMinutes, s.elapsedMinutes])).toEqual([
      ['2026-11-02', 1020, 90]
    ]);
    expect(
      planSessions(terms({ endsOn: '2026-11-02', endsAtMinutes: 900 }), '2026-11-02', '2026-11-02')
    ).toEqual([]);
  });

  it('never plans before the start date', () => {
    expect(planSessions(terms(), '2026-10-01', '2026-10-30')).toEqual([]);
  });
});

describe('planCycle', () => {
  it('anchors 3-day cycles to the start date with zone-computed instants', () => {
    const cycle = planCycle(terms(), 0)!;
    expect(cycle).toMatchObject({ index: 0, startsOn: '2026-10-31', endsOn: '2026-11-02' });
    expect(cycle.startsAt.toISOString()).toBe('2026-10-31T04:00:00.000Z'); // 00:00 EDT
    expect(cycle.holdAt.toISOString()).toBe('2026-10-30T04:00:00.000Z'); // 24 h before
    // First session Sunday 01:00 is on day 2, so 07:00 on day 1 is earlier.
    expect(cycle.captureAt.toISOString()).toBe('2026-10-31T11:00:00.000Z');
    expect(cycle.endsAt.toISOString()).toBe('2026-11-03T05:00:00.000Z'); // 00:00 EST
    expect(cycle.transferAt.toISOString()).toBe('2026-11-05T05:00:00.000Z');
    expect(planCycle(terms(), 1)).toMatchObject({ startsOn: '2026-11-03', endsOn: '2026-11-05' });
  });

  it('holds CONTRACT_HOLD_LEAD_HOURS (real hours) before the cycle starts', () => {
    expect(planCycle(terms({ holdLeadHours: 48 }), 0)!.holdAt.toISOString()).toBe(
      '2026-10-29T04:00:00.000Z'
    );
    // Cycle 1 starts 2026-11-03 00:00 EST; 24 real hours before is 00:00 EST
    // on 11-02. 48 h before crosses the fall-back night, so it is 01:00 EDT
    // on 11-01 — not the wall-clock midnight (04:00Z) the old rule used.
    expect(planCycle(terms(), 1)!.holdAt.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(planCycle(terms({ holdLeadHours: 48 }), 1)!.holdAt.toISOString()).toBe(
      '2026-11-01T05:00:00.000Z'
    );
    expect(planCycle(terms({ holdLeadHours: 6 }), 0)!.holdAt.toISOString()).toBe(
      '2026-10-30T22:00:00.000Z'
    );
  });

  it('captures an hour before an early first session', () => {
    const early = planCycle(terms({ startsOn: '2026-11-01' }), 0)!;
    // Sunday 01:00 EDT − 1 h = 00:00 EDT, earlier than 07:00 EST.
    expect(early.captureAt.toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });

  it('cuts the last cycle at the effective end and plans nothing after it', () => {
    const last = planCycle(terms({ endsOn: '2026-11-04', endsAtMinutes: null }), 1)!;
    expect(last).toMatchObject({ startsOn: '2026-11-03', endsOn: '2026-11-04' });
    expect(last.endsAt.toISOString()).toBe('2026-11-05T05:00:00.000Z');
    expect(planCycle(terms({ endsOn: '2026-11-04' }), 2)).toBeNull();
  });
});

describe('planWindow', () => {
  it('plans 14 days of sessions and every cycle they fall in, then continues', () => {
    const first = planWindow(terms(), '2026-10-28', null);
    expect(first.through).toBe('2026-11-10');
    expect(first.cycles.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(first.sessions.map((s) => s.date)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-08',
      '2026-11-09'
    ]);
    const next = planWindow(terms(), '2026-10-29', first.through);
    expect(next.through).toBe('2026-11-11');
    expect(next.sessions).toEqual([]);
    expect(next.cycles.map((c) => c.index)).toEqual([3]);
  });

  it('plans nothing while the start is beyond the window', () => {
    expect(planWindow(terms({ startsOn: '2026-12-31' }), '2026-10-28', null)).toEqual({
      cycles: [],
      sessions: [],
      through: null
    });
  });

  it('stops at the effective end', () => {
    const window = planWindow(terms({ endsOn: '2026-11-02' }), '2026-10-28', null);
    expect(window.through).toBe('2026-11-02');
    expect(window.cycles.map((c) => c.index)).toEqual([0]);
  });
});

describe('firstSessionStart (UAT round 2: the lead-time rule)', () => {
  it('is the first dated session on or after the start date', () => {
    // Starts Sat 31 Oct; the first pattern day is Sun 1 Nov 01:00 EDT.
    expect(firstSessionStart(terms())?.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    // Starting on a Monday: that Monday's 15:30 EST.
    expect(firstSessionStart(terms({ startsOn: '2026-11-02' }))?.toISOString()).toBe(
      '2026-11-02T20:30:00.000Z'
    );
  });

  it('respects the negotiated end and its last-day end time', () => {
    // Ends on the Saturday it starts: no session ever happens.
    expect(firstSessionStart(terms({ endsOn: '2026-10-31' }))).toBeNull();
    // Starts and ends Mon 2 Nov at 15:00: its 15:30 session is cut away.
    expect(
      firstSessionStart(
        terms({ startsOn: '2026-11-02', endsOn: '2026-11-02', endsAtMinutes: 900 })
      )
    ).toBeNull();
  });

  it('finds a pattern whose only weekday is six days after the start', () => {
    const fridayOnly = terms({
      startsOn: '2026-10-31',
      services: [
        {
          serviceId: 'svc-care',
          name: 'Childcare',
          rateCents: 2500,
          sessions: [{ weekday: 4, startMinutes: 600, endMinutes: 660 }]
        }
      ]
    });
    expect(firstSessionStart(fridayOnly)?.toISOString()).toBe('2026-11-06T15:00:00.000Z');
  });
});
