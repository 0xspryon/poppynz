import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';

const billingValidationError = {
  code: 'INVALID_BILLING_INPUT',
  message: 'Billing input contains invalid or unsupported fields.'
} as const;

/** The browser finished a card setup. Only the id travels — what happened is
 * re-fetched from the provider. */
export const billingCardConfirmSchema = Schema.Struct({
  setupId: Schema.Trim.pipe(Schema.nonEmptyString(), Schema.maxLength(255))
});

export const validateBillingCardConfirmInput = validateInput(
  billingCardConfirmSchema,
  billingValidationError
);

export const billingJsonError = billingValidationError;
