import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';
import { validLanguages } from '@/api/lib/constants';

const profileUpdateValidationError = {
  code: 'INVALID_PROFILE_INPUT',
  message: 'Profile update contains invalid or unsupported fields.'
} as const;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.nonEmptyString());
const nullableOptionalNonEmptyString = Schema.optional(Schema.NullOr(trimmedNonEmptyString));

/** A real calendar date of birth, YYYY-MM-DD, between 1900 and today — a
 * typed "198501" year used to be accepted (UAT #13). */
export const isPlausibleDateOfBirth = (value: string, today: Date = new Date()) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  return value >= '1900-01-01' && value <= today.toISOString().slice(0, 10);
};

const dateOfBirth = Schema.Trim.pipe(
  Schema.filter((value) => isPlausibleDateOfBirth(value), {
    message: () => 'Date of birth must be a real date between 1900 and today.'
  })
);

export const profileUpdateSchema = Schema.Struct({
  language: Schema.optional(Schema.Literal(...validLanguages)),
  firstName: nullableOptionalNonEmptyString,
  lastName: nullableOptionalNonEmptyString,
  gender: Schema.optional(Schema.NullOr(Schema.Literal('male', 'female'))),
  phoneNumber: nullableOptionalNonEmptyString,
  dateOfBirth: Schema.optional(Schema.NullOr(dateOfBirth)),
  address: nullableOptionalNonEmptyString,
  city: nullableOptionalNonEmptyString,
  postalCode: nullableOptionalNonEmptyString,
  country: nullableOptionalNonEmptyString,
  stateProvince: nullableOptionalNonEmptyString,
  shortBio: Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(512))))
});

export const profileLocationUpdateSchema = Schema.Struct({
  googlePlaceId: trimmedNonEmptyString.pipe(Schema.maxLength(512))
});

// The key handed back by POST /uploads/presigned-url for a
// `public-profile-picture` upload; ownership is checked in the handler.
export const profilePhotoUpdateSchema = Schema.Struct({
  fileKey: trimmedNonEmptyString.pipe(Schema.maxLength(512))
});

export type ProfileUpdateInput = Schema.Schema.Type<typeof profileUpdateSchema>;
export type ProfileLocationUpdateInput = Schema.Schema.Type<typeof profileLocationUpdateSchema>;
export type ProfilePhotoUpdateInput = Schema.Schema.Type<typeof profilePhotoUpdateSchema>;

export const validateProfileUpdateInput = validateInput(
  profileUpdateSchema,
  profileUpdateValidationError
);

export const validateProfileLocationUpdateInput = validateInput(
  profileLocationUpdateSchema,
  profileUpdateValidationError
);

export const validateProfilePhotoUpdateInput = validateInput(
  profilePhotoUpdateSchema,
  profileUpdateValidationError
);

export const profileUpdateJsonError = profileUpdateValidationError;
