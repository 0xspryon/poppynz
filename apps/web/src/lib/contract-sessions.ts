/** Proposed weekly sessions (Flow F). Times are wall-clock minutes from
 * midnight in New Zealand local time — never UTC — so "3:30–6:00 pm" stays
 * 3:30–6:00 pm across DST changes. Weekday 0 = Monday … 6 = Sunday. */

export type ContractSession = {
	weekday: number;
	startMinutes: number;
	endMinutes: number;
};

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const MINUTES_PER_DAY = 24 * 60;

export const sessionMinutes = (session: ContractSession) =>
	session.endMinutes - session.startMinutes;

export const weeklyMinutes = (sessions: ReadonlyArray<ContractSession>) =>
	sessions.reduce((total, session) => total + sessionMinutes(session), 0);

/** "2.5" for 150 minutes, "2" for 120 — no trailing zeros. */
export const minutesToHours = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);

/** Per-service weekly cost, rounded to whole cents (mirrors the API). */
export const serviceWeeklyCents = (rateCents: number, sessions: ReadonlyArray<ContractSession>) =>
	Math.round((rateCents * weeklyMinutes(sessions)) / 60);

/** 930 → "3:30 pm", 720 → "12:00 pm", 0 → "12:00 am". */
export function formatMinutes(minutes: number): string {
	const hours24 = Math.floor(minutes / 60) % 24;
	const mins = minutes % 60;
	const suffix = hours24 < 12 ? 'am' : 'pm';
	const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
	return `${hours12}:${String(mins).padStart(2, '0')} ${suffix}`;
}

/** "3:30–6:00 pm" — the shared am/pm suffix is dropped from the start. */
export function formatSessionRange(session: ContractSession): string {
	const start = formatMinutes(session.startMinutes);
	const end = formatMinutes(session.endMinutes);
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
