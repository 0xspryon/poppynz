import { Schema } from 'effect';
import punycode from 'ts-punycode';
import { validateInput } from '@/api/lib/schema-validator';

const signinValidationError = {
  code: 'INVALID_SIGNIN_INPUT',
  message: 'A valid email is required.'
} as const;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizedEmailSchema = Schema.Trim.pipe(
  Schema.transform(Schema.String, {
    decode: (email) => punycode.toASCII(email.toLowerCase()),
    encode: (email) => email
  }),
  Schema.pattern(emailPattern)
);

export const signinInputSchema = Schema.Struct({
  email: normalizedEmailSchema
});

export type SigninInput = Schema.Schema.Type<typeof signinInputSchema>;

export const validateSigninInput = validateInput(signinInputSchema, signinValidationError);

export const signinJsonError = signinValidationError;
