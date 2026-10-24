import { dateIn } from '@repo/calendar';
import type { TaxCollectedSource } from '@repo/db';

/** Poppynz's books are kept in Toronto time: a charge belongs to the month
 * (or quarter) of its capture there. */
export const TAX_REPORT_ZONE = 'America/Toronto';

export type TaxReportPeriod = 'month' | 'quarter';

export type TaxCollectedRow = {
  /** "2026-11" or "2026-Q4". */
  period: string;
  jurisdiction: string;
  component: string;
  supplyType: string;
  rateMillipercent: number;
  /** Sum of the taxed bases. */
  baseCents: number;
  /** Sum of the tax collected. */
  taxCents: number;
  /** How many frozen lines were summed. */
  lines: number;
};

export const periodOf = (at: Date, period: TaxReportPeriod, zone = TAX_REPORT_ZONE): string => {
  const date = dateIn(at, zone);
  const [year, month] = date.split('-');
  return period === 'month' ? `${year}-${month}` : `${year}-Q${Math.ceil(Number(month) / 3)}`;
};

/** Period × jurisdiction × component × supply type (× rate, so a rate change
 * inside a period shows as two rows), from the FROZEN lines only. */
export const aggregateTaxCollected = (
  sources: ReadonlyArray<TaxCollectedSource>,
  period: TaxReportPeriod
): Array<TaxCollectedRow> => {
  const rows = new Map<string, TaxCollectedRow>();
  for (const source of sources) {
    const bucket = periodOf(source.capturedAt, period);
    for (const line of source.taxLines) {
      const key = [
        bucket,
        line.jurisdiction,
        line.component,
        line.supplyType,
        line.rateMillipercent
      ].join('|');
      const row = rows.get(key) ?? {
        period: bucket,
        jurisdiction: line.jurisdiction,
        component: line.component,
        supplyType: line.supplyType,
        rateMillipercent: line.rateMillipercent,
        baseCents: 0,
        taxCents: 0,
        lines: 0
      };
      row.baseCents += line.baseCents;
      row.taxCents += line.taxCents;
      row.lines += 1;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      a.period.localeCompare(b.period) ||
      a.jurisdiction.localeCompare(b.jurisdiction) ||
      a.component.localeCompare(b.component) ||
      a.supplyType.localeCompare(b.supplyType) ||
      a.rateMillipercent - b.rateMillipercent
  );
};

const cents = (value: number) => (value / 100).toFixed(2);
const percent = (millipercent: number) => String(millipercent / 1000);

/** The report as CSV (amounts in dollars, comma-free fields). */
export const taxCollectedCsv = (rows: ReadonlyArray<TaxCollectedRow>): string =>
  [
    'period,jurisdiction,component,supply_type,rate_percent,base_cad,tax_cad,lines',
    ...rows.map((row) =>
      [
        row.period,
        row.jurisdiction,
        row.component.toUpperCase(),
        row.supplyType,
        percent(row.rateMillipercent),
        cents(row.baseCents),
        cents(row.taxCents),
        row.lines
      ].join(',')
    )
  ].join('\n') + '\n';
