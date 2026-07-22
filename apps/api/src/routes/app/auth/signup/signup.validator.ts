import { Schema } from "effect";
import punycode from "ts-punycode";
import { validRoles } from "@/api/lib/constants";
import { validateInput } from "@/api/lib/schema-validator";

export const signupValidationError = {
  code: "INVALID_SIGNUP_INPUT",
  message: "A valid email and role are required.",
} as const;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizedEmailSchema = Schema.Trim.pipe(
  Schema.transform(Schema.String, {
    decode: (email) => punycode.toASCII(email.toLowerCase()),
    encode: (email) => email,
  }),
  Schema.pattern(emailPattern),
);

export const signupInputSchema = Schema.Struct({
  email: normalizedEmailSchema,
  role: Schema.Literal(...validRoles),
});

export type SignupInput = Schema.Schema.Type<typeof signupInputSchema>;

export const validateSignupInput = validateInput(signupInputSchema, signupValidationError);