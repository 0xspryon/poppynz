import { Schema } from "effect";
import { validateInput } from "@/api/lib/schema-validator";

const geocodingValidationError = {
  code: "INVALID_GEOCODING_INPUT",
  message: "Geocoding input contains invalid or unsupported fields.",
} as const;

export const googlePlaceLookupSchema = Schema.Struct({
  placeId: Schema.Trim.pipe(Schema.nonEmptyString(), Schema.maxLength(512)),
});

export const placeSuggestionsSchema = Schema.Struct({
  query: Schema.Trim.pipe(Schema.nonEmptyString(), Schema.maxLength(256)),
});

export type GooglePlaceLookupInput = Schema.Schema.Type<typeof googlePlaceLookupSchema>;
export type PlaceSuggestionsInput = Schema.Schema.Type<typeof placeSuggestionsSchema>;

export const validateGooglePlaceLookupInput = validateInput(googlePlaceLookupSchema, geocodingValidationError);
export const validatePlaceSuggestionsInput = validateInput(placeSuggestionsSchema, geocodingValidationError);
