import { Temporal } from 'temporal-polyfill';

/**
 * Calendar and time-zone arithmetic — the only place in the monorepo that
 * knows about time zones. Everything here is browser-safe; the location →
 * zone lookup lives in `./lookup` because its boundary data is server-only.
 *
 * Conventions: a calendar date is a zone-less `YYYY-MM-DD` string, a moment is
 * a UTC `Date`, and the zone is always an explicit IANA-name parameter.
 */

/** A calendar date, `YYYY-MM-DD`, with no time zone attached. */
export type IsoDate = string;

export const MINUTES_PER_DAY = 24 * 60;

/** The calendar date an instant falls on in `zone`. */
export const dateIn = (at: Date, zone: string): IsoDate =>
  Temporal.Instant.fromEpochMilliseconds(at.getTime())
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();

/** Today's calendar date in `zone`. */
export const todayIn = (zone: string, now: Date = new Date()): IsoDate => dateIn(now, zone);

/** Pure calendar arithmetic — no zone, no DST. */
export const addDays = (date: IsoDate, days: number): IsoDate =>
  Temporal.PlainDate.from(date).add({ days }).toString();

/**
 * Wall-clock minutes (0–1440, 1440 = the next midnight) on `date` in `zone` →
 * the UTC instant.
 *
 * A time repeated by the fall-back takes its first occurrence (Temporal's
 * default). A time inside the spring-forward gap does not exist: Temporal
 * would push it past the gap by the gap's length (02:30 → 03:30); our rule is
 * the moment the clock resumes (03:00), so nobody's session loses time.
 */
export const instantAt = (date: IsoDate, minutes: number, zone: string): Date => {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    throw new RangeError(`minutes must be an integer in 0..${MINUTES_PER_DAY}, got ${minutes}`);
  }
  const day =
    minutes === MINUTES_PER_DAY
      ? Temporal.PlainDate.from(date).add({ days: 1 })
      : Temporal.PlainDate.from(date);
  const wall = minutes % MINUTES_PER_DAY;
  const time = Temporal.PlainTime.from({ hour: Math.floor(wall / 60), minute: wall % 60 });
  const zoned = day.toZonedDateTime({ timeZone: zone, plainTime: time });
  if (!zoned.toPlainTime().equals(time)) {
    // Temporal pushed the time past the gap, so `zoned` is at or after the
    // transition. 'previous' is strictly before its receiver: step 1 ns
    // forward so a time landing exactly on the transition (the gap's first
    // minute, e.g. 02:00, or a midnight gap) still finds this transition and
    // not the one months earlier.
    const resumed = zoned.add({ nanoseconds: 1 }).getTimeZoneTransition('previous');
    if (resumed) return new Date(resumed.epochMilliseconds);
  }
  return new Date(zoned.epochMilliseconds);
};

/**
 * Real elapsed minutes of one session on `date` in `zone` — 3 h or 5 h for a
 * 01:00–05:00 session on DST nights. `endCapMinutes` is the last-day end time:
 * a session crossing it is shortened, one starting at or after it counts 0.
 */
export const sessionElapsedMinutes = (
  date: IsoDate,
  session: { startMinutes: number; endMinutes: number },
  zone: string,
  endCapMinutes: number | null = null
): number => {
  const end =
    endCapMinutes === null ? session.endMinutes : Math.min(session.endMinutes, endCapMinutes);
  if (end <= session.startMinutes) return 0;
  const startAt = instantAt(date, session.startMinutes, zone).getTime();
  const endAt = instantAt(date, end, zone).getTime();
  return Math.round((endAt - startAt) / 60_000);
};

/** "Central Time" — the generic name, which doesn't flip twice a year the way
 * "Central Daylight Time" does. Falls back to the IANA name. */
export const zoneLabel = (zone: string, locale = 'en-CA', at: Date = new Date()): string =>
  new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'longGeneric' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value ?? zone;
