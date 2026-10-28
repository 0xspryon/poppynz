import { obligationStatuses, obligationTypes } from '@repo/billing';
import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';

const isoDate = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}$/, { message: () => 'Expected a date as YYYY-MM-DD.' }),
  Schema.filter((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()), {
    message: () => 'Expected a real calendar date.'
  })
);

/** `a,b,c` → `['a','b','c']` (empty → absent). */
const list = <const L extends ReadonlyArray<string>>(values: L) =>
  Schema.transform(Schema.String, Schema.Array(Schema.Literal(...values)), {
    strict: false,
    decode: (raw) =>
      raw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    encode: (values) => (values as ReadonlyArray<string>).join(',')
  });

export const reimbursementQueryError = {
  code: 'INVALID_REIMBURSEMENT_QUERY',
  message: 'The filters are invalid.'
} as const;
export const reimbursementQuerySchema = Schema.Struct({
  type: Schema.optional(list(obligationTypes)),
  status: Schema.optional(list(obligationStatuses)),
  from: Schema.optional(isoDate),
  to: Schema.optional(isoDate),
  party: Schema.optional(Schema.Trim.pipe(Schema.maxLength(200))),
  contract: Schema.optional(Schema.UUID)
});
export const validateReimbursementQuery = validateInput(
  reimbursementQuerySchema,
  reimbursementQueryError
);

export const itemKeyError = {
  code: 'INVALID_ITEM_KEY',
  message: 'A valid item key is required.'
} as const;
/** `<type>:<id>` (the id may itself contain `:`). */
export const validateItemKey = validateInput(
  Schema.String.pipe(Schema.pattern(/^[a-z_]{3,40}:[A-Za-z0-9:_-]{1,200}$/)),
  itemKeyError
);

export const noteError = {
  code: 'INVALID_REIMBURSEMENT_NOTE',
  message: 'Write a note (at most 2000 characters).'
} as const;
export const noteSchema = Schema.Struct({
  note: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(2000))
});
export const validateNote = validateInput(noteSchema, noteError);

export const reconcileError = {
  code: 'INVALID_RECONCILE_INPUT',
  message: 'Say whether the item is reconciled; a note is optional.'
} as const;
export const reconcileSchema = Schema.Struct({
  reconciled: Schema.Boolean,
  note: Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(2000))))
});
export const validateReconcile = validateInput(reconcileSchema, reconcileError);

export const reportKinds = ['liabilities', 'refunds', 'absorbed', 'fees'] as const;
export type ReportKind = (typeof reportKinds)[number];
export const reportQueryError = {
  code: 'INVALID_ACCOUNTANT_REPORT_QUERY',
  message: 'Pick a report and a period (from, to).'
} as const;
export const reportQuerySchema = Schema.Struct({
  report: Schema.Literal(...reportKinds),
  from: isoDate,
  to: isoDate
});
export const validateReportQuery = validateInput(reportQuerySchema, reportQueryError);

export const periodError = {
  code: 'INVALID_RECONCILIATION_PERIOD',
  message: 'Pick a period (from, to).'
} as const;
export const periodSchema = Schema.Struct({
  from: isoDate,
  to: isoDate,
  view: Schema.optional(Schema.Literal('exceptions', 'all'))
});
export const validatePeriod = validateInput(periodSchema, periodError);

export const runError = {
  code: 'INVALID_RECONCILIATION_RUN',
  message: 'Pick the period to import (from, to).'
} as const;
export const runSchema = Schema.Struct({ from: isoDate, to: isoDate });
export const validateRun = validateInput(runSchema, runError);

export const resolveError = {
  code: 'INVALID_RECONCILIATION_RESOLUTION',
  message: 'Explain how the item was resolved (at most 2000 characters).'
} as const;
export const resolveSchema = Schema.Struct({
  resolved: Schema.optional(Schema.Boolean),
  note: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(2000))
});
export const validateResolve = validateInput(resolveSchema, resolveError);
