import { addDays, dateIn, instantAt } from '@repo/calendar';

/** Poppynz keeps its books in Toronto time (as the tax report does): an
 * amount belongs to the month of its date there. */
export const BOOKS_ZONE = 'America/Toronto';

/** "2026-11". */
export const monthOf = (at: Date, zone = BOOKS_ZONE) => dateIn(at, zone).slice(0, 7);

/** The first instant of the month after `month` ("2026-11" → Dec 1st 00:00
 * Toronto): every month-end snapshot is taken just before it. */
export const monthEnd = (month: string, zone = BOOKS_ZONE): Date => {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const next =
    monthNumber === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01`;
  return instantAt(next, 0, zone);
};

/** Every month from `from` to `to` (Toronto dates, inclusive). */
export const monthsBetween = (from: string, to: string): Array<string> => {
  const months: Array<string> = [];
  let cursor = `${from.slice(0, 7)}-01`;
  const last = to.slice(0, 7);
  while (cursor.slice(0, 7) <= last && months.length < 600) {
    months.push(cursor.slice(0, 7));
    cursor = addDays(`${cursor.slice(0, 7)}-28`, 4).slice(0, 7) + '-01';
  }
  return months;
};

/** `[from 00:00, to + 1 day 00:00)` in Toronto time. */
export const dayRange = (from: string, to: string, zone = BOOKS_ZONE) => ({
  from: instantAt(from, 0, zone),
  to: instantAt(addDays(to, 1), 0, zone)
});

export const dollars = (cents: number) => (cents / 100).toFixed(2);

/** A plain number ("-12.50", "3"): left as is, so a spreadsheet sums it. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
/** What a spreadsheet would read as a formula (or a DDE call). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** A CSV field: quoted when it holds a comma, a quote or a line break.
 * Text a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, tab or
 * carriage return first — a family's name, an admin's note, a provider
 * description) is neutralised with a leading apostrophe (OWASP "CSV
 * injection"); plain numbers, negative amounts included, are left alone. */
export const csvField = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const csv = (header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<unknown>>) =>
  [
    header.join(','),
    ...rows.map((row) => row.map((value) => csvField(value as string)).join(','))
  ].join('\n') + '\n';
