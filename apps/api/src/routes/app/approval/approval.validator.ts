import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { validApprovalStatuses, validApprovalTypes } from "../../../lib/constants";

export const approvalInputSchema = z
  .object({
    userId: z.string().trim().min(1),
    type: z.enum(validApprovalTypes),
    status: z.enum(validApprovalStatuses),
    reason: z.string().trim().min(1).nullable().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.status === "rejected" && !input.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A rejection reason is required.",
      });
    }
  });

export type ApprovalInput = z.infer<typeof approvalInputSchema>;

export const approvalValidator = zValidator("json", approvalInputSchema, (result, c) => {
  if (!result.success) {
    return c.json(
      {
        error: {
          code: "INVALID_APPROVAL_INPUT" as const,
          message: "Approval request contains invalid or unsupported fields.",
          issues: result.error.issues,
        },
      },
      400,
    );
  }
});
