import { Schema } from "effect";
import { validateInput } from "@/api/lib/schema-validator";

const approvalRequestValidationError = {
  code: "INVALID_APPROVAL_REQUEST_INPUT",
  message: "Approval request input contains invalid or unsupported fields.",
} as const;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.nonEmptyString());

export const approvalRequestRejectSchema = Schema.Struct({
  reason: trimmedNonEmptyString,
});

export type ApprovalRequestRejectInput = Schema.Schema.Type<typeof approvalRequestRejectSchema>;
export const validateApprovalRequestRejectInput = validateInput(approvalRequestRejectSchema, approvalRequestValidationError);
export const approvalRequestJsonError = approvalRequestValidationError;
