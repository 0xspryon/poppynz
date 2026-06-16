import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { validKycDocumentTypes } from "../../../lib/constants";

const baseUploadInputSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive(),
});

export const uploadPresignInputSchema = z.discriminatedUnion("target", [
  baseUploadInputSchema.extend({
    target: z.literal("kyc-document"),
    documentType: z.enum(validKycDocumentTypes),
  }),
  baseUploadInputSchema.extend({
    target: z.literal("public-profile-picture"),
  }),
]);

export type UploadPresignInput = z.infer<typeof uploadPresignInputSchema>;

export const uploadPresignValidator = zValidator("json", uploadPresignInputSchema, (result, c) => {
  if (!result.success) {
    return c.json(
      {
        error: {
          code: "INVALID_UPLOAD_PRESIGN_INPUT" as const,
          message: "Upload request contains invalid or unsupported fields.",
          issues: result.error.issues,
        },
      },
      400,
    );
  }
});
