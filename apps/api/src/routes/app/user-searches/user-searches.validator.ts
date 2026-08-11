import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';

const userSearchValidationError = {
  code: 'INVALID_USER_SEARCH_INPUT',
  message: 'User search input contains invalid or unsupported fields.'
} as const;

const optionalBoundedString = (max: number) =>
  Schema.optional(Schema.Trim.pipe(Schema.maxLength(max)));

// The full family marketplace filter set, mirrored from the find page. Every
// field is optional — an all-defaults search that came up empty is still worth
// telling the team about.
export const userSearchCreateSchema = Schema.Struct({
  q: optionalBoundedString(200),
  service: optionalBoundedString(120),
  city: optionalBoundedString(120),
  radiusKm: Schema.optional(Schema.Number.pipe(Schema.positive())),
  minHourlyRateCents: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  maxHourlyRateCents: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  sort: Schema.optional(
    Schema.Literal('relevance', 'distance', 'price_asc', 'price_desc', 'newest')
  )
});

export type UserSearchCreateInput = Schema.Schema.Type<typeof userSearchCreateSchema>;

export const validateUserSearchCreateInput = validateInput(
  userSearchCreateSchema,
  userSearchValidationError
);
export const userSearchJsonError = userSearchValidationError;
