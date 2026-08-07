import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';

const tcValidationError = {
  code: 'INVALID_TC_INPUT',
  message: 'Terms and conditions input contains invalid or unsupported fields.'
} as const;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.nonEmptyString());

// Admins are never a T&C audience — "all" covers the non-admin profiles.
export const tcAudienceRoleSchema = Schema.Literal('family', 'service-provider');
export const tcAppliesToRoleSchema = Schema.Literal('all', 'family', 'service-provider');

export const tcDocumentCreateSchema = Schema.Struct({
  slug: trimmedNonEmptyString.pipe(Schema.maxLength(80), Schema.pattern(/^[a-z0-9][a-z0-9_-]*$/)),
  title: trimmedNonEmptyString.pipe(Schema.maxLength(160)),
  appliesToRole: tcAppliesToRoleSchema
});

export const tcDocumentUpdateSchema = Schema.partial(
  Schema.Struct({
    title: trimmedNonEmptyString.pipe(Schema.maxLength(160)),
    appliesToRole: tcAppliesToRoleSchema
  })
);

export const tcDraftSchema = Schema.Struct({
  description: trimmedNonEmptyString.pipe(Schema.maxLength(500)),
  content: trimmedNonEmptyString.pipe(Schema.maxLength(200_000)),
  checkboxLabel: trimmedNonEmptyString.pipe(Schema.maxLength(500))
});

export const tcDraftUpdateSchema = Schema.partial(tcDraftSchema);

export const tcAcceptSchema = Schema.Struct({
  acceptances: Schema.Array(
    Schema.Struct({
      slug: trimmedNonEmptyString.pipe(Schema.maxLength(80)),
      versionId: trimmedNonEmptyString.pipe(Schema.maxLength(64))
    })
  ).pipe(Schema.minItems(1))
});

export type TcAudienceRoleInput = Schema.Schema.Type<typeof tcAudienceRoleSchema>;
export type TcDocumentCreateInput = Schema.Schema.Type<typeof tcDocumentCreateSchema>;
export type TcDocumentUpdateInput = Schema.Schema.Type<typeof tcDocumentUpdateSchema>;
export type TcDraftInput = Schema.Schema.Type<typeof tcDraftSchema>;
export type TcDraftUpdateInput = Schema.Schema.Type<typeof tcDraftUpdateSchema>;
export type TcAcceptInput = Schema.Schema.Type<typeof tcAcceptSchema>;

export const validateTcAudienceRole = validateInput(tcAudienceRoleSchema, tcValidationError);
export const validateTcDocumentCreateInput = validateInput(
  tcDocumentCreateSchema,
  tcValidationError
);
export const validateTcDocumentUpdateInput = validateInput(
  tcDocumentUpdateSchema,
  tcValidationError
);
export const validateTcDraftInput = validateInput(tcDraftSchema, tcValidationError);
export const validateTcDraftUpdateInput = validateInput(tcDraftUpdateSchema, tcValidationError);
export const validateTcAcceptInput = validateInput(tcAcceptSchema, tcValidationError);
export const tcJsonError = tcValidationError;
