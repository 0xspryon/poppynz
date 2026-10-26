import {
  addDays,
  daysBetween,
  instantAt,
  sessionElapsedMinutes,
  weekdayOf,
  type IsoDate
} from '@repo/calendar';
import { sessionValueCents } from '../pricing';

/**
 * Billing schedule planning (piece 3 spec §1, §2). Pure: from the accepted
 * weekly pattern, the contract zone and the effective end, which dated
 * sessions exist and which 3-day cycle bills them, with every instant
 * computed once from the contract zone and handed back in UTC.
 */

export const CYCLE_DAYS = 3;
/** Sessions exist this many days ahead (the 2-week notice period). */
export const SESSION_WINDOW_DAYS = 14;
/** `CONTRACT_HOLD_LEAD_HOURS`' default (UAT round 2: 1 day, was 2). */
export const DEFAULT_HOLD_LEAD_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

export type PlannedService = {
  readonly serviceId: string;
  readonly name: string;
  readonly rateCents: number;
  readonly sessions: ReadonlyArray<{ weekday: number; startMinutes: number; endMinutes: number }>;
};

export type ScheduleTerms = {
  readonly services: ReadonlyArray<PlannedService>;
  readonly startsOn: IsoDate;
  readonly timeZone: string;
  /** The effective last working day, if any, and its end time. */
  readonly endsOn: IsoDate | null;
  readonly endsAtMinutes: number | null;
  /** How long before the cycle start its amount is held
   * (`CONTRACT_HOLD_LEAD_HOURS`); defaults to `DEFAULT_HOLD_LEAD_HOURS`. */
  readonly holdLeadHours?: number;
};

export type PlannedSession = {
  readonly date: IsoDate;
  readonly slot: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly elapsedMinutes: number;
  readonly rateCents: number;
  readonly valueCents: number;
};

export type PlannedCycle = {
  readonly index: number;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly holdAt: Date;
  readonly captureAt: Date;
  readonly transferAt: Date;
};

export const slotOf = (serviceId: string, startMinutes: number) => `${serviceId}@${startMinutes}`;

export const cycleIndexOf = (terms: Pick<ScheduleTerms, 'startsOn'>, date: IsoDate): number =>
  Math.floor(daysBetween(terms.startsOn, date) / CYCLE_DAYS);

const lastDay = (terms: ScheduleTerms, date: IsoDate) =>
  terms.endsOn !== null && date === terms.endsOn;

/** The sessions dated `from`…`through` (inclusive), within the contract's
 * start and effective end. A session on the last day is cut at its end
 * time; one starting at or after it does not exist. */
export const planSessions = (
  terms: ScheduleTerms,
  from: IsoDate,
  through: IsoDate
): Array<PlannedSession> => {
  const first = from < terms.startsOn ? terms.startsOn : from;
  const last = terms.endsOn !== null && terms.endsOn < through ? terms.endsOn : through;
  const planned: Array<PlannedSession> = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const weekday = weekdayOf(date);
    const cap = lastDay(terms, date) ? terms.endsAtMinutes : null;
    for (const service of terms.services) {
      for (const session of service.sessions) {
        if (session.weekday !== weekday) continue;
        const endMinutes = cap === null ? session.endMinutes : Math.min(session.endMinutes, cap);
        if (endMinutes <= session.startMinutes) continue;
        const elapsedMinutes = sessionElapsedMinutes(date, session, terms.timeZone, cap);
        planned.push({
          date,
          slot: slotOf(service.serviceId, session.startMinutes),
          serviceId: service.serviceId,
          serviceName: service.name,
          startMinutes: session.startMinutes,
          endMinutes,
          startsAt: instantAt(date, session.startMinutes, terms.timeZone),
          endsAt: instantAt(date, endMinutes, terms.timeZone),
          elapsedMinutes,
          rateCents: service.rateCents,
          valueCents: sessionValueCents(service.rateCents, elapsedMinutes)
        });
      }
    }
  }
  return planned.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
};

/** When the contract's first dated session starts (UTC), or null when the
 * terms never produce one (an end date before the first pattern day). The
 * weekly pattern repeats, so the first week from the start date decides. */
export const firstSessionStart = (terms: ScheduleTerms): Date | null =>
  planSessions(terms, terms.startsOn, addDays(terms.startsOn, 6))[0]?.startsAt ?? null;

/** Cycle `index`, or null when it starts after the effective end. */
export const planCycle = (terms: ScheduleTerms, index: number): PlannedCycle | null => {
  const startsOn = addDays(terms.startsOn, index * CYCLE_DAYS);
  if (terms.endsOn !== null && startsOn > terms.endsOn) return null;
  const fullEnd = addDays(startsOn, CYCLE_DAYS - 1);
  const endsOn = terms.endsOn !== null && terms.endsOn < fullEnd ? terms.endsOn : fullEnd;
  const zone = terms.timeZone;
  const startsAt = instantAt(startsOn, 0, zone);
  const endsAt = instantAt(addDays(endsOn, 1), 0, zone);
  const sevenAm = instantAt(startsOn, 7 * 60, zone);
  const firstSession = planSessions(terms, startsOn, endsOn)[0];
  const beforeFirst = firstSession ? new Date(firstSession.startsAt.getTime() - HOUR_MS) : null;
  return {
    index,
    startsOn,
    endsOn,
    startsAt,
    endsAt,
    // The cycle start minus the hold lead: real elapsed hours, so a DST
    // night in between doesn't move it by an hour on the wall clock.
    holdAt: new Date(
      startsAt.getTime() - (terms.holdLeadHours ?? DEFAULT_HOLD_LEAD_HOURS) * HOUR_MS
    ),
    captureAt: beforeFirst !== null && beforeFirst < sevenAm ? beforeFirst : sevenAm,
    // 48 h after the cycle ends, once every session is past its report
    // window (piece 4 transfers on it).
    transferAt: new Date(endsAt.getTime() + 48 * HOUR_MS)
  };
};

/** The materialisation step for one tick: every cycle and session dated
 * from the day after `materialisedThrough` (or the start) up to `today + 13`
 * in the contract zone. Cycles come whole, so a cycle straddling the window
 * edge is planned once with all its instants; its later sessions arrive on
 * later ticks. */
export const planWindow = (
  terms: ScheduleTerms,
  today: IsoDate,
  materialisedThrough: IsoDate | null
): {
  cycles: Array<PlannedCycle>;
  sessions: Array<PlannedSession>;
  /** The new `materialised_through`; unchanged when nothing was due. */
  through: IsoDate | null;
} => {
  const windowEnd = addDays(today, SESSION_WINDOW_DAYS - 1);
  const through = terms.endsOn !== null && terms.endsOn < windowEnd ? terms.endsOn : windowEnd;
  const from = materialisedThrough === null ? terms.startsOn : addDays(materialisedThrough, 1);
  if (from > through) return { cycles: [], sessions: [], through: materialisedThrough };
  const sessions = planSessions(terms, from, through);
  const cycles: Array<PlannedCycle> = [];
  const firstIndex = Math.max(
    0,
    cycleIndexOf(terms, from < terms.startsOn ? terms.startsOn : from)
  );
  const lastIndex = cycleIndexOf(terms, through);
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const cycle = planCycle(terms, index);
    if (cycle) cycles.push(cycle);
  }
  return { cycles, sessions, through };
};
