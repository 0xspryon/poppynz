/** Shared date formatting, in the active locale (en-CA / fr-CA). Date-only
 * strings (YYYY-MM-DD) are parsed as local dates on purpose — `new Date(iso)`
 * would read them as UTC midnight and shift a day west of Greenwich. */
import { intlLocale } from '$lib/locale';
import { m } from '$lib/paraglide/messages';

const parseLocal = (value: string): Date => {
	const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (dateOnly) {
		return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
	}
	return new Date(value);
};

/** "Aug 4, 2026" / "4 août 2026" */
export function formatDate(value: string): string {
	return parseLocal(value).toLocaleDateString(intlLocale(), {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
}

/** "Tue, Aug 4, 2026" / "mar. 4 août 2026" — start dates and last working days read better with the
 * weekday (16d/16i). */
export function formatDateWithWeekday(value: string): string {
	return parseLocal(value).toLocaleDateString(intlLocale(), {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
}

/** An instant in a given time zone, whatever the viewer's: "Oct 31, 2026,
 * 11:59 p.m." in Toronto — the books' month ends are Toronto's. */
export function formatDateTimeIn(value: string, timeZone: string): string {
	const at = new Date(value);
	return m.date_time_at({
		date: at.toLocaleDateString(intlLocale(), {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone
		}),
		time: at.toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit', timeZone })
	});
}

/** "Aug 4, 2026, 9:48 a.m." / "4 août 2026, 9 h 48" */
export function formatDateTime(value: string): string {
	return m.date_time_at({ date: formatDate(value), time: formatTime(value) });
}

/** "9:48 a.m." / "9 h 48" */
export function formatTime(value: string): string {
	return parseLocal(value).toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit' });
}

/** "Today" / "Yesterday" / "Aug 4" / "Aug 4, 2025" (localized) — list rows. */
export function relativeDayLabel(value: string, now: Date = new Date()): string {
	const date = parseLocal(value);
	const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000));
	if (dayDiff === 0) return m.date_today();
	if (dayDiff === 1) return m.date_yesterday();
	return date.toLocaleDateString(intlLocale(), {
		day: 'numeric',
		month: 'short',
		...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
	});
}

/**
 * A CALENDAR date — a document's expiry or issue date, a check's "valid
 * until" — which has no time of day. The API sends these either as
 * "YYYY-MM-DD" or as a UTC-midnight timestamp ("2030-01-15T00:00:00.000Z"),
 * and formatting either through `new Date()` in a zone west of Greenwich
 * showed the day before (UAT #28). Only the date part is ever read here.
 */
export function formatCalendarDate(value: string): string {
	const datePart = /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1];
	return formatDate(datePart ?? value);
}

/** "YYYY-MM-DD" for a date input, in the viewer's own zone (never UTC). */
export function toDateInputValue(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today as "YYYY-MM-DD" in the viewer's zone. */
export const todayInputValue = (now: Date = new Date()) => toDateInputValue(now);
