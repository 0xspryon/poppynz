import { Schema } from "effect";
import { validKycDocumentTypes } from "../../../lib/constants";
import { validateInput } from "@/api/lib/schema-validator";

const uploadPresignValidationError = {
  code: "INVALID_UPLOAD_PRESIGN_INPUT",
  message: "Upload request contains invalid or unsupported fields.",
} as const;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.nonEmptyString());

const baseUploadInputFields = {
  fileName: trimmedNonEmptyString.pipe(Schema.maxLength(255)),
  contentType: trimmedNonEmptyString.pipe(Schema.maxLength(120)),
  sizeBytes: Schema.Number.pipe(Schema.int(), Schema.positive()),
};

export const uploadPresignInputSchema = Schema.Union(
  Schema.Struct({
    ...baseUploadInputFields,
    target: Schema.Literal("kyc-document"),
    documentType: Schema.Literal(...validKycDocumentTypes),
  }),
  Schema.Struct({
    ...baseUploadInputFields,
    target: Schema.Literal("public-profile-picture"),
  }),
);

export type UploadPresignInput = Schema.Schema.Type<typeof uploadPresignInputSchema>;

export const validateUploadPresignInput = validateInput(
  uploadPresignInputSchema,
  uploadPresignValidationError,
);

export const uploadPresignJsonError = uploadPresignValidationError;
