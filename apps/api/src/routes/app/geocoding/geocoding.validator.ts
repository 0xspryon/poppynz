import { Schema } from "effect";
import { validateInput } from "@/api/lib/schema-validator";

const geocodingValidationError = {
  code: "INVALID_GEOCODING_INPUT",
  message: "Geocoding input contains invalid or unsupported fields.",
} as const;

export const googlePlaceLookupSchema = Schema.Struct({
  placeId: Schema.Trim.pipe(Schema.nonEmptyString(), Schema.maxLength(512)),
});

export type GooglePlaceLookupInput = Schema.Schema.Type<typeof googlePlaceLookupSchema>;

export const validateGooglePlaceLookupInput = validateInput(googlePlaceLookupSchema, geocodingValidationError);
