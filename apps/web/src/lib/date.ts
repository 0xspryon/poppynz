/** Shared date formatting for contracts (and future callers). Date-only
 * strings (YYYY-MM-DD) are parsed as local dates on purpose — `new Date(iso)`
 * would read them as UTC midnight and shift a day west of Greenwich. */

const parseLocal = (value: string): Date => {
	const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (dateOnly) {
		return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
	}
	return new Date(value);
};

/** "4 Aug 2026" */
export function formatDate(value: string): string {
	return parseLocal(value).toLocaleDateString('en-CA', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
}

/** "Mon 4 Aug 2026" — start dates and last working days read better with the
 * weekday (16d/16i). */
export function formatDateWithWeekday(value: string): string {
	return parseLocal(value).toLocaleDateString('en-CA', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
}

/** "4 Aug 2026, 9:48 a.m." */
export function formatDateTime(value: string): string {
	const date = parseLocal(value);
	return `${formatDate(value)}, ${date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}`;
}

/** "Today" / "Yesterday" / "4 Aug" / "4 Aug 2025" — list rows. */
export function relativeDayLabel(value: string, now: Date = new Date()): string {
	const date = parseLocal(value);
	const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000));
	if (dayDiff === 0) return 'Today';
	if (dayDiff === 1) return 'Yesterday';
	return date.toLocaleDateString('en-CA', {
		day: 'numeric',
		month: 'short',
		...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
	});
}
