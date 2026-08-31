import { credibledCheckTypeValues } from '@repo/credibled';
import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';

const kycDocTypeValidationError = {
  code: 'INVALID_KYC_DOCUMENT_TYPE_INPUT',
  message: 'KYC document type input contains invalid or unsupported fields.'
} as const;

const kycDocValidationError = {
  code: 'INVALID_KYC_DOCUMENT_INPUT',
  message: 'KYC document input contains invalid or unsupported fields.'
} as const;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.nonEmptyString());

export const kycDocumentTypeCreateSchema = Schema.Struct({
  name: trimmedNonEmptyString.pipe(Schema.maxLength(120)),
  appliesToRole: Schema.optional(Schema.Literal('service-provider')),
  isOptional: Schema.Boolean,
  requiresExpiryDate: Schema.Boolean,
  // Null means upload-only. Constraining to the known catalogue stops an
  // admin saving a value the API would later reject at order time.
  credibledCheckTypeValue: Schema.optional(
    Schema.NullOr(Schema.Literal(...credibledCheckTypeValues))
  ),
  // Pre-tax price in cents. Credibled publishes no pricing, so an admin sets
  // it; capped well above any plausible check to catch a stray extra digit.
  credibledCostCents: Schema.optional(
    Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.between(0, 500_000)))
  )
});

export const kycDocumentTypeUpdateSchema = Schema.partial(kycDocumentTypeCreateSchema);

export const kycDocumentSubmitSchema = Schema.Struct({
  documentTypeId: trimmedNonEmptyString,
  filename: trimmedNonEmptyString.pipe(Schema.maxLength(255)),
  fileKey: trimmedNonEmptyString,
  expiryDate: Schema.optional(Schema.NullOr(trimmedNonEmptyString))
});

export const kycDocumentExpiryUpdateSchema = Schema.Struct({
  expiryDate: Schema.NullOr(trimmedNonEmptyString)
});

export type KycDocumentTypeCreateInput = Schema.Schema.Type<typeof kycDocumentTypeCreateSchema>;
export type KycDocumentTypeUpdateInput = Schema.Schema.Type<typeof kycDocumentTypeUpdateSchema>;
export type KycDocumentSubmitInput = Schema.Schema.Type<typeof kycDocumentSubmitSchema>;
export type KycDocumentExpiryUpdateInput = Schema.Schema.Type<typeof kycDocumentExpiryUpdateSchema>;

export const validateKycDocumentTypeCreateInput = validateInput(
  kycDocumentTypeCreateSchema,
  kycDocTypeValidationError
);
export const validateKycDocumentTypeUpdateInput = validateInput(
  kycDocumentTypeUpdateSchema,
  kycDocTypeValidationError
);
export const validateKycDocumentSubmitInput = validateInput(
  kycDocumentSubmitSchema,
  kycDocValidationError
);
export const validateKycDocumentExpiryUpdateInput = validateInput(
  kycDocumentExpiryUpdateSchema,
  kycDocValidationError
);
export const kycDocTypeJsonError = kycDocTypeValidationError;
export const kycDocJsonError = kycDocValidationError;
