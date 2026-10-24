import { addDays } from '@repo/calendar';
import { formatNumber, getLocale, intlLocale } from '$lib/locale';
import { m } from '$lib/paraglide/messages';

/** Proposed weekly sessions (Flow F). Times are wall-clock minutes from
 * midnight in the contract's own time zone (the family's) — never UTC — so "3:30–6:00 pm" stays
 * 3:30–6:00 pm across DST changes. Weekday 0 = Monday … 6 = Sunday. */

export type ContractSession = {
	weekday: number;
	startMinutes: number;
	endMinutes: number;
};

/** Short weekday name in the active locale: 0 → "Mon" / "lun." (Monday-first,
 * like `ContractSession.weekday`). */
export function weekdayLabel(weekday: number, style: 'short' | 'long' = 'short'): string {
	// 2026-01-05 is a Monday.
	return new Date(2026, 0, 5 + weekday).toLocaleDateString(intlLocale(), { weekday: style });
}

/** Monday … Sunday, short, in the active locale. */
export const weekdayLabels = (): string[] =>
	Array.from({ length: 7 }, (_, weekday) => weekdayLabel(weekday));

export const MINUTES_PER_DAY = 24 * 60;

export const sessionMinutes = (session: ContractSession) =>
	session.endMinutes - session.startMinutes;

export const weeklyMinutes = (sessions: ReadonlyArray<ContractSession>) =>
	sessions.reduce((total, session) => total + sessionMinutes(session), 0);

/** "2.5" ("2,5" in French) for 150 minutes, "2" for 120 — no trailing zeros. */
export const minutesToHours = (minutes: number) =>
	formatNumber(Math.round((minutes / 60) * 100) / 100, { maximumFractionDigits: 2 });

/** Per-service weekly cost, rounded to whole cents (mirrors the API). */
export const serviceWeeklyCents = (rateCents: number, sessions: ReadonlyArray<ContractSession>) =>
	Math.round((rateCents * weeklyMinutes(sessions)) / 60);

/** 930 → "3:30 pm", 720 → "12:00 pm", 0 → "12:00 am" — in French the
 * 24-hour Quebec style: "15 h 30", "12 h", "0 h". */
export function formatMinutes(minutes: number): string {
	const hours24 = Math.floor(minutes / 60) % 24;
	const mins = minutes % 60;
	if (getLocale() === 'fr') {
		return mins === 0 ? `${hours24} h` : `${hours24} h ${String(mins).padStart(2, '0')}`;
	}
	const suffix = hours24 < 12 ? 'am' : 'pm';
	const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
	return `${hours12}:${String(mins).padStart(2, '0')} ${suffix}`;
}

/** A last-day end time: like session times, except 1440 is "midnight" (the
 * end of that day, not 12:00 am at its start). */
export const formatEndTime = (minutes: number): string =>
	minutes >= MINUTES_PER_DAY ? m.contracts_time_midnight() : formatMinutes(minutes);

export const END_NOTICE_DAYS = 14;

/** The last working day if notice were given on `today` (a calendar date in
 * the contract's zone): notice + 14 days, unless the signed terms end on or
 * before that — then the negotiated end wins, with its last-day end time.
 * Mirrors the API's `effectiveEnd`. */
export function noticeLastDay(
	today: string,
	negotiated: { endsOn: string | null; endsAtMinutes: number | null } | null
): { endsOn: string; endsAtMinutes: number | null } {
	const notice = addDays(today, END_NOTICE_DAYS);
	if (negotiated?.endsOn && negotiated.endsOn <= notice) {
		return { endsOn: negotiated.endsOn, endsAtMinutes: negotiated.endsAtMinutes ?? null };
	}
	return { endsOn: notice, endsAtMinutes: null };
}

/** "3:30–6:00 pm" — the shared am/pm suffix is dropped from the start
 * ("15 h 30–18 h" in French, which has no suffix). */
export function formatSessionRange(session: ContractSession): string {
	const start = formatMinutes(session.startMinutes);
	const end = formatMinutes(session.endMinutes);
	if (getLocale() === 'fr') return `${start}–${end}`;
	const [startTime, startSuffix] = start.split(' ');
	const [, endSuffix] = end.split(' ');
	return startSuffix === endSuffix ? `${startTime}–${end}` : `${start}–${end}`;
}

export const sessionsOverlap = (a: ContractSession, b: ContractSession) =>
	a.weekday === b.weekday && a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;

/** Sessions of `others` that a candidate overlaps — overlap is warned, never
 * blocked; the provider judges the week as a whole at review. */
export const overlapping = (candidate: ContractSession, others: ReadonlyArray<ContractSession>) =>
	others.filter((other) => sessionsOverlap(candidate, other));

/** Stable per-day chronological ordering for grids and the week strip. */
export const bySessionStart = (a: ContractSession, b: ContractSession) =>
	a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes;

/** Two-letter code for the week-at-a-glance strip: first letters of the first
 * two words, or the first two letters of a one-word name ("Childcare" → CC —
 * doubled initial reads better than a lone C). */
export function serviceCode(name: string): string {
	const words = name
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.slice(0, 2);
	if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
	const word = words[0] ?? '?';
	return (word[0] + (word[1] ?? word[0])).toUpperCase();
}
