import { Schema } from "effect";
import { validateInput } from "@/api/lib/schema-validator";

const approvalValidationError = {
  code: "INVALID_APPROVAL_INPUT",
  message: "Approval request contains invalid or unsupported fields.",
} as const;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.nonEmptyString());

const approvalExpirySchema = trimmedNonEmptyString.pipe(
  Schema.transform(Schema.DateFromSelf, {
    decode: (value) => new Date(value),
    encode: (value) => value.toISOString(),
  }),
  Schema.filter((date) => {
    if (Number.isNaN(date.getTime()) || date <= new Date()) {
      return {
        path: ["expiresAt"],
        message: "Approval expiry date must be a valid future date.",
      };
    }
  }),
);

export const approvalCreateInputSchema = Schema.Struct({
  userId: trimmedNonEmptyString,
  approvalRequestId: trimmedNonEmptyString,
  expiresAt: approvalExpirySchema,
});

export type ApprovalInput = Schema.Schema.Type<typeof approvalCreateInputSchema>;

export const validateApprovalInput = validateInput(approvalCreateInputSchema, approvalValidationError);
export const approvalJsonError = approvalValidationError;
