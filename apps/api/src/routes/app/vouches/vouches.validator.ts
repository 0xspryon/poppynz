import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';
import { normalizedEmailSchema } from '../auth/signup/signup.validator';

export const vouchValidationError = {
  code: 'INVALID_VOUCH_INPUT',
  message: 'Vouch input contains invalid or unsupported fields.'
} as const;

const requiredText = (max: number) =>
  Schema.Trim.pipe(Schema.nonEmptyString(), Schema.maxLength(max));
const optionalText = Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(2000))));
const trustAnswer = Schema.Literal('yes', 'no', 'unsure');

export const vouchRequestSchema = Schema.Struct({
  email: normalizedEmailSchema,
  relationship: requiredText(300)
});

export const vouchSubmitSchema = Schema.Struct({
  howKnow: requiredText(1000),
  howLong: requiredText(100),
  wouldTrust: trustAnswer,
  hasConcerns: Schema.Boolean,
  concernsDetail: optionalText,
  wouldHire: trustAnswer,
  anythingElse: optionalText,
  // The attestation is not optional: a vouch without it is not a vouch.
  attested: Schema.Literal(true)
});

export const vouchAdminActionSchema = Schema.Struct({ reason: requiredText(500) });

export type VouchRequestInput = Schema.Schema.Type<typeof vouchRequestSchema>;
export type VouchSubmitInput = Schema.Schema.Type<typeof vouchSubmitSchema>;

export const validateVouchRequestInput = validateInput(vouchRequestSchema, vouchValidationError);
export const validateVouchSubmitInput = validateInput(vouchSubmitSchema, vouchValidationError);
export const validateVouchAdminActionInput = validateInput(
  vouchAdminActionSchema,
  vouchValidationError
);
export const vouchJsonError = vouchValidationError;
