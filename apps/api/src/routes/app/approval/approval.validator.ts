import { Schema } from "effect";
import { validApprovalStatuses, validApprovalTypes } from "@/api/lib/constants";
import { validateInput } from "@/api/lib/schema-validator";

const approvalValidationError = {
  code: "INVALID_APPROVAL_INPUT",
  message: "Approval request contains invalid or unsupported fields.",
} as const;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.nonEmptyString());

export const approvalInputSchema = Schema.Struct({
  userId: trimmedNonEmptyString,
  type: Schema.Literal(...validApprovalTypes),
  status: Schema.Literal(...validApprovalStatuses),
  reason: Schema.optional(Schema.NullOr(trimmedNonEmptyString)),
}).pipe(
  Schema.filter((approval) => {
    if (approval.status === "rejected" && !approval.reason) {
      return {
        path: ["reason"],
        message: "A rejection reason is required.",
      };
    }
  }),
);

export type ApprovalInput = Schema.Schema.Type<typeof approvalInputSchema>;

export const validateApprovalInput = validateInput(
  approvalInputSchema,
  approvalValidationError,
);

export const approvalJsonError = approvalValidationError;
