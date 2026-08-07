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
  isFetchable: Schema.optional(Schema.Boolean)
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
