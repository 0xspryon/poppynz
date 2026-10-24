import {
  PLACES_OF_SUPPLY,
  SUPPLY_TYPES,
  TAX_COMPONENTS,
  TAX_TREATMENTS
} from '@repo/billing/pricing';
import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';

const taxValidationError = {
  code: 'INVALID_TAX_CONFIG_INPUT',
  message: 'Tax configuration input contains invalid or unsupported fields.'
} as const;

const reportValidationError = {
  code: 'INVALID_TAX_REPORT_QUERY',
  message: 'The report period is invalid.'
} as const;

const isoDate = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}$/, { message: () => 'Expected a date as YYYY-MM-DD.' }),
  Schema.filter((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()), {
    message: () => 'Expected a real calendar date.'
  })
);

/** Why the change is made — mandatory on every write, kept in the audit. */
const reason = Schema.Trim.pipe(
  Schema.nonEmptyString({ message: () => 'Give a reason for this change.' }),
  Schema.maxLength(500)
);

const component = Schema.Literal(...TAX_COMPONENTS);
const jurisdictionCode = Schema.Trim.pipe(Schema.pattern(/^[A-Z]{2}$/));

/** Every write: when the new value takes effect (and, optionally, ends),
 * why, and — for a date already past — an explicit confirmation. */
const effective = {
  effectiveFrom: isoDate,
  effectiveTo: Schema.optional(Schema.NullOr(isoDate)),
  reason,
  confirmPastEffectiveDate: Schema.optional(Schema.Boolean)
};

export const taxRateWriteSchema = Schema.Struct({
  jurisdictionCode,
  component,
  // Thousandths of a percent: 5% = 5000. Never negative, never over 100%.
  rateMillipercent: Schema.Number.pipe(
    Schema.int(),
    Schema.nonNegative({ message: () => 'A rate cannot be negative.' }),
    Schema.lessThanOrEqualTo(100_000)
  ),
  ...effective
});

export const taxTreatmentWriteSchema = Schema.Struct({
  supplyTypeCode: Schema.Literal(...SUPPLY_TYPES),
  treatment: Schema.Literal(...TAX_TREATMENTS),
  components: Schema.Array(component),
  placeOfSupply: Schema.Literal(...PLACES_OF_SUPPLY),
  ...effective
});

export const taxRegistrationWriteSchema = Schema.Struct({
  jurisdictionCode,
  program: Schema.Trim.pipe(Schema.pattern(/^[a-z_]{2,20}$/)),
  components: Schema.Array(component).pipe(Schema.minItems(1)),
  registrationNumber: Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(40))),
  registered: Schema.Boolean,
  ...effective
});

export const taxReportQuerySchema = Schema.Struct({
  from: isoDate,
  to: isoDate,
  period: Schema.optional(Schema.Literal('month', 'quarter'))
});

export type TaxRateWriteInput = Schema.Schema.Type<typeof taxRateWriteSchema>;
export type TaxTreatmentWriteInput = Schema.Schema.Type<typeof taxTreatmentWriteSchema>;
export type TaxRegistrationWriteInput = Schema.Schema.Type<typeof taxRegistrationWriteSchema>;
export type TaxReportQuery = Schema.Schema.Type<typeof taxReportQuerySchema>;

export const validateTaxRateWrite = validateInput(taxRateWriteSchema, taxValidationError);
export const validateTaxTreatmentWrite = validateInput(taxTreatmentWriteSchema, taxValidationError);
export const validateTaxRegistrationWrite = validateInput(
  taxRegistrationWriteSchema,
  taxValidationError
);
export const validateTaxReportQuery = validateInput(taxReportQuerySchema, reportValidationError);
export const taxJsonError = taxValidationError;
