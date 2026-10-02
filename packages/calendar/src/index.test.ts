import { describe, expect, it } from 'bun:test';
import {
  addDays,
  dateIn,
  instantAt,
  sessionElapsedMinutes,
  todayIn,
  zoneLabel
} from './index';

const WPG = 'America/Winnipeg';

describe('dateIn / todayIn', () => {
  it('reads the calendar date in the zone, not in UTC', () => {
    // 04:30Z is still 23:30 the previous evening in Winnipeg (CDT, UTC-5).
    expect(dateIn(new Date('2026-09-24T04:30:00Z'), WPG)).toBe('2026-09-23');
    expect(todayIn(WPG, new Date('2026-09-24T05:30:00Z'))).toBe('2026-09-24');
  });

  it('handles the half-hour Newfoundland offset', () => {
    // NDT is UTC-2:30: 02:15Z is 23:45 the previous day.
    expect(dateIn(new Date('2026-07-02T02:15:00Z'), 'America/St_Johns')).toBe('2026-07-01');
  });
});

describe('addDays', () => {
  it('rolls over months and years', () => {
    expect(addDays('2026-10-24', 14)).toBe('2026-11-07');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('instantAt', () => {
  it('converts wall-clock minutes to the UTC instant', () => {
    expect(instantAt('2026-07-01', 540, WPG).toISOString()).toBe('2026-07-01T14:00:00.000Z');
  });

  it('reads 1440 as the next midnight', () => {
    expect(instantAt('2026-07-01', 1440, WPG).toISOString()).toBe('2026-07-02T05:00:00.000Z');
  });

  it('moves a time inside the spring-forward gap to the moment the clock resumes', () => {
    // 2026-03-08 02:00 CST jumps to 03:00 CDT (08:00Z); 02:30 does not exist.
    expect(instantAt('2026-03-08', 150, WPG).toISOString()).toBe('2026-03-08T08:00:00.000Z');
  });

  it('maps the first and last minutes of the gap to the moment the clock resumes', () => {
    // 02:00 is the first non-existent minute; 02:59 the last.
    expect(instantAt('2026-03-08', 120, WPG).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(instantAt('2026-03-08', 179, WPG).toISOString()).toBe('2026-03-08T08:00:00.000Z');
  });

  it('handles a gap at midnight (Santiago springs forward 00:00 → 01:00)', () => {
    // 2026-09-06 00:00 -04 does not exist; the clock resumes at 01:00 -03 (04:00Z).
    expect(instantAt('2026-09-06', 0, 'America/Santiago').toISOString()).toBe(
      '2026-09-06T04:00:00.000Z'
    );
    expect(instantAt('2026-09-05', 1440, 'America/Santiago').toISOString()).toBe(
      '2026-09-06T04:00:00.000Z'
    );
  });

  it('takes the first occurrence of a time repeated by the fall-back', () => {
    // 2026-11-01 01:30 happens at 06:30Z (CDT) and again at 07:30Z (CST).
    expect(instantAt('2026-11-01', 90, WPG).toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });

  it('rejects minutes outside 0..1440', () => {
    expect(() => instantAt('2026-07-01', 1441, WPG)).toThrow(RangeError);
  });
});

describe('sessionElapsedMinutes', () => {
  const overnight = { startMinutes: 60, endMinutes: 300 }; // 01:00–05:00

  it('bills the scheduled length on an ordinary day', () => {
    expect(sessionElapsedMinutes('2026-07-01', overnight, WPG)).toBe(240);
  });

  it('bills 3 real hours on the spring-forward night', () => {
    expect(sessionElapsedMinutes('2026-03-08', overnight, WPG)).toBe(180);
  });

  it('bills 5 real hours on the fall-back night', () => {
    expect(sessionElapsedMinutes('2026-11-01', overnight, WPG)).toBe(300);
  });

  it('follows Toronto transitions at Toronto 2:00, not Winnipeg 2:00', () => {
    expect(sessionElapsedMinutes('2026-03-08', overnight, 'America/Toronto')).toBe(180);
  });

  it('never changes length in Regina (no DST)', () => {
    expect(sessionElapsedMinutes('2026-03-08', overnight, 'America/Regina')).toBe(240);
    expect(sessionElapsedMinutes('2026-11-01', overnight, 'America/Regina')).toBe(240);
  });

  it('counts a session starting exactly at the gap', () => {
    // 02:00–05:00 on spring-forward night: 03:00 CDT → 05:00 CDT.
    expect(
      sessionElapsedMinutes('2026-03-08', { startMinutes: 120, endMinutes: 300 }, WPG)
    ).toBe(120);
  });

  it('counts a session ending exactly at the gap', () => {
    // 00:00–02:00 on spring-forward night: 00:00 CST → 03:00 CDT is 2 real hours.
    expect(sessionElapsedMinutes('2026-03-08', { startMinutes: 0, endMinutes: 120 }, WPG)).toBe(
      120
    );
  });

  it('counts a gap start from the moment the clock resumes', () => {
    // 02:30–05:00 on spring-forward night: 03:00 CDT → 05:00 CDT.
    expect(
      sessionElapsedMinutes('2026-03-08', { startMinutes: 150, endMinutes: 300 }, WPG)
    ).toBe(120);
  });

  it('cuts a session at the last-day end time', () => {
    const day = { startMinutes: 540, endMinutes: 1020 }; // 09:00–17:00
    expect(sessionElapsedMinutes('2026-07-01', day, WPG, 720)).toBe(180);
  });

  it('drops a session that starts at or after the end time', () => {
    const afternoon = { startMinutes: 780, endMinutes: 1020 }; // 13:00–17:00
    expect(sessionElapsedMinutes('2026-07-01', afternoon, WPG, 720)).toBe(0);
    expect(sessionElapsedMinutes('2026-07-01', { startMinutes: 720, endMinutes: 780 }, WPG, 720)).toBe(0);
  });

  it('ignores a cap later than the session', () => {
    expect(sessionElapsedMinutes('2026-07-01', { startMinutes: 540, endMinutes: 660 }, WPG, 720)).toBe(120);
  });
});

describe('zoneLabel', () => {
  it('uses the generic name that does not flip with DST', () => {
    const summer = new Date('2026-07-01T12:00:00Z');
    const winter = new Date('2026-01-15T12:00:00Z');
    expect(zoneLabel(WPG, 'en-CA', summer)).toBe('Central Time');
    expect(zoneLabel(WPG, 'en-CA', winter)).toBe('Central Time');
    expect(zoneLabel('America/Toronto', 'en-CA', summer)).toBe('Eastern Time');
    expect(zoneLabel('America/Vancouver', 'en-CA', summer)).toBe('Pacific Time');
  });
});
