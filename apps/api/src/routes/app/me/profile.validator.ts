import { Schema } from "effect";
import { validateInput } from "@/api/lib/schema-validator";

const profileUpdateValidationError = {
  code: "INVALID_PROFILE_INPUT",
  message: "Profile update contains invalid or unsupported fields.",
} as const;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.nonEmptyString());
const nullableOptionalNonEmptyString = Schema.optional(
  Schema.NullOr(trimmedNonEmptyString),
);

export const profileUpdateSchema = Schema.Struct({
  firstName: nullableOptionalNonEmptyString,
  lastName: nullableOptionalNonEmptyString,
  gender: Schema.optional(Schema.NullOr(Schema.Literal("male", "female"))),
  phoneNumber: nullableOptionalNonEmptyString,
  dateOfBirth: nullableOptionalNonEmptyString,
  address: nullableOptionalNonEmptyString,
  city: nullableOptionalNonEmptyString,
  postalCode: nullableOptionalNonEmptyString,
  country: nullableOptionalNonEmptyString,
  stateProvince: nullableOptionalNonEmptyString,
  shortBio: Schema.optional(Schema.NullOr(Schema.Trim)),
});

export type ProfileUpdateInput = Schema.Schema.Type<typeof profileUpdateSchema>;

export const validateProfileUpdateInput = validateInput(
  profileUpdateSchema,
  profileUpdateValidationError,
);

export const profileUpdateJsonError = profileUpdateValidationError;
