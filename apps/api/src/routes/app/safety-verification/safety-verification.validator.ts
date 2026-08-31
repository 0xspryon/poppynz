import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';

const safetyVerificationValidationError = {
  code: 'INVALID_SAFETY_VERIFICATION_INPUT',
  message: 'Safety verification input contains invalid or unsupported fields.'
} as const;

const safetyVerificationDecisionError = {
  code: 'INVALID_SAFETY_VERIFICATION_DECISION',
  message: 'Safety verification decision input contains invalid or unsupported fields.'
} as const;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.nonEmptyString());

// `YYYY-MM-DD` only. Accepting a full ISO timestamp here would let a client
// smuggle a timezone in and shift the expiry date by a day.
const dateOnly = trimmedNonEmptyString.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/));

/**
 * Ordering a check through Credibled.
 *
 * Consent is explicit and mandatory — the applicant is about to have their
 * identity and criminal history searched. The policy version they agreed to is
 * stamped server-side rather than accepted from the client, so a stale page
 * can't record consent against a policy that no longer exists.
 */
export const safetyVerificationOrderSchema = Schema.Struct({
  consentAccepted: Schema.Literal(true)
});

/**
 * Submitting an existing vulnerable-sector document.
 *
 * Everything here is applicant-asserted, which is exactly why the resulting
 * record is `review_required` and labelled "submitted for review" rather than
 * verified.
 */
export const safetyVerificationDocumentSchema = Schema.Struct({
  consentAccepted: Schema.Literal(true),
  issuingAuthority: trimmedNonEmptyString.pipe(Schema.maxLength(120)),
  documentNumber: trimmedNonEmptyString.pipe(Schema.maxLength(60)),
  filename: trimmedNonEmptyString.pipe(Schema.maxLength(255)),
  fileKey: trimmedNonEmptyString.pipe(Schema.maxLength(512)),
  issuedOn: dateOnly,
  expiresOn: dateOnly
});

/** Adding a check to the basket. The price and the Credibled check type come
 * from the document type server-side — a client that could name its own price
 * could order a $45 check for nothing. */
export const safetyVerificationItemSchema = Schema.Struct({
  documentTypeId: trimmedNonEmptyString.pipe(Schema.maxLength(64))
});

export const safetyVerificationDecisionSchema = Schema.Struct({
  decision: Schema.Literal('approve', 'reject'),
  // A rejection has to say why — the applicant sees this string.
  reason: Schema.optional(Schema.Trim.pipe(Schema.maxLength(500))),
  // Approving a Credibled check needs no expiry (policy supplies it); approving
  // an uploaded document uses the date on the document, which the admin may
  // correct if the applicant typed it wrong.
  expiresOn: Schema.optional(dateOnly)
});

export type SafetyVerificationOrderInput = Schema.Schema.Type<typeof safetyVerificationOrderSchema>;
export type SafetyVerificationDocumentInput = Schema.Schema.Type<
  typeof safetyVerificationDocumentSchema
>;
export type SafetyVerificationDecisionInput = Schema.Schema.Type<
  typeof safetyVerificationDecisionSchema
>;
export type SafetyVerificationItemInput = Schema.Schema.Type<typeof safetyVerificationItemSchema>;

export const validateSafetyVerificationOrderInput = validateInput(
  safetyVerificationOrderSchema,
  safetyVerificationValidationError
);
export const validateSafetyVerificationDocumentInput = validateInput(
  safetyVerificationDocumentSchema,
  safetyVerificationValidationError
);
export const validateSafetyVerificationItemInput = validateInput(
  safetyVerificationItemSchema,
  safetyVerificationValidationError
);
export const validateSafetyVerificationDecisionInput = validateInput(
  safetyVerificationDecisionSchema,
  safetyVerificationDecisionError
);

export const safetyVerificationJsonError = safetyVerificationValidationError;
export const safetyVerificationDecisionJsonError = safetyVerificationDecisionError;
