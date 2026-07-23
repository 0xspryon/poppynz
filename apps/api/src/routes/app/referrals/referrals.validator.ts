import { Schema } from "effect";
import { validRoles } from "@/api/lib/constants";
import { validateInput } from "@/api/lib/schema-validator";
import { normalizedEmailSchema } from "../auth/signup/signup.validator";

export const referralValidationError = {
  code: "INVALID_REFERRAL_INPUT",
  message: "A valid email and role are required.",
} as const;

export const referralCreateSchema = Schema.Struct({
  email: normalizedEmailSchema,
  role: Schema.Literal(...validRoles),
});

export type ReferralCreateInput = Schema.Schema.Type<typeof referralCreateSchema>;

export const validateReferralCreateInput = validateInput(
  referralCreateSchema,
  referralValidationError,
);

export const referralJsonError = referralValidationError;
