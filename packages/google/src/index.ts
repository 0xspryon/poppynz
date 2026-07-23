import { googleMapsConfig } from "@repo/env";
import { Context, Data, Effect, Layer } from "effect";

// Backed by Places API (New) — places.googleapis.com/v1. The legacy
// maps.googleapis.com/maps/api/place endpoints are not enableable on new
// Google Cloud projects.

export type GooglePlaceLocation = {
  googlePlaceId: string;
  formattedAddress: string | null;
  city: string | null;
  stateProvince: string | null;
  stateProvinceCode: string | null;
  country: string | null;
  countryCode: string | null;
  postalCode: string | null;
  latitude: number;
  longitude: number;
};

export type GooglePlaceSuggestion = {
  placeId: string;
  description: string;
};

export class GooglePlacesError extends Data.TaggedError("GooglePlacesError")<{
  operation: "placeDetails" | "autocomplete";
  placeId: string;
  cause: unknown;
}> { }

export class GooglePlaceNotFoundError extends Data.TaggedError("GooglePlaceNotFoundError")<{
  placeId: string;
}> { }

export class GooglePlaceInvalidError extends Data.TaggedError("GooglePlaceInvalidError")<{
  placeId: string;
  message: string;
}> { }

export class GooglePlaces extends Context.Tag("@repo/google/GooglePlaces")<
  GooglePlaces,
  {
    lookupPlaceById: (
      placeId: string,
    ) => Effect.Effect<GooglePlaceLocation, GooglePlacesError | GooglePlaceNotFoundError | GooglePlaceInvalidError>;
    autocompletePlaces: (query: string) => Effect.Effect<Array<GooglePlaceSuggestion>, GooglePlacesError>;
  }
>() { }

type AddressComponent = {
  longText?: string;
  shortText?: string;
  types?: Array<string>;
};

type PlaceDetailsResponse = {
  id?: string;
  formattedAddress?: string;
  addressComponents?: Array<AddressComponent>;
  location?: {
    latitude?: number;
    longitude?: number;
  };
};

type AutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
    };
  }>;
};

const findComponent = (components: Array<AddressComponent>, type: string) =>
  components.find((component) => component.types?.includes(type)) ?? null;

const getCity = (components: Array<AddressComponent>) =>
  findComponent(components, "locality") ??
  findComponent(components, "postal_town") ??
  findComponent(components, "administrative_area_level_3") ??
  findComponent(components, "administrative_area_level_2");

const normalizePlaceDetails = (placeId: string, result: PlaceDetailsResponse) => {
  const latitude = result.location?.latitude;
  const longitude = result.location?.longitude;

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return Effect.fail(new GooglePlaceInvalidError({ placeId, message: "Google place is missing coordinates." }));
  }

  const components = result.addressComponents ?? [];
  const city = getCity(components);
  const stateProvince = findComponent(components, "administrative_area_level_1");
  const country = findComponent(components, "country");
  const postalCode = findComponent(components, "postal_code");

  return Effect.succeed({
    googlePlaceId: result.id ?? placeId,
    formattedAddress: result.formattedAddress ?? null,
    city: city?.longText ?? null,
    stateProvince: stateProvince?.longText ?? null,
    stateProvinceCode: stateProvince?.shortText ?? null,
    country: country?.longText ?? null,
    countryCode: country?.shortText ?? null,
    postalCode: postalCode?.longText ?? null,
    latitude,
    longitude,
  });
};

const makeGooglePlaces = (config: { apiKey: string }): Context.Tag.Service<GooglePlaces> => ({
  autocompletePlaces: (query) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Goog-Api-Key": config.apiKey,
          },
          body: JSON.stringify({ input: query, includedRegionCodes: ['ca'] }),
        });

        if (!response.ok) {
          throw new GooglePlacesError({
            operation: "autocomplete",
            placeId: query,
            cause: { status: response.status, body: await response.text() },
          });
        }

        const body = (await response.json()) as AutocompleteResponse;

        return (body.suggestions ?? []).flatMap((suggestion) => {
          const prediction = suggestion.placePrediction;
          return prediction?.placeId && prediction.text?.text
            ? [{ placeId: prediction.placeId, description: prediction.text.text }]
            : [];
        });
      },
      catch: (cause) =>
        cause instanceof GooglePlacesError
          ? cause
          : new GooglePlacesError({ operation: "autocomplete", placeId: query, cause }),
    }),
  lookupPlaceById: (placeId) =>
    Effect.gen(function*() {
      const result = yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(
            `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
            {
              headers: {
                "X-Goog-Api-Key": config.apiKey,
                "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents",
              },
            },
          );

          if (response.status === 404) {
            throw new GooglePlaceNotFoundError({ placeId });
          }

          if (!response.ok) {
            throw new GooglePlacesError({
              operation: "placeDetails",
              placeId,
              cause: { status: response.status, body: await response.text() },
            });
          }

          return (await response.json()) as PlaceDetailsResponse;
        },
        catch: (cause) =>
          cause instanceof GooglePlaceNotFoundError || cause instanceof GooglePlacesError
            ? cause
            : new GooglePlacesError({ operation: "placeDetails", placeId, cause }),
      });

      return yield* normalizePlaceDetails(placeId, result);
    }),
});

export const GooglePlacesLive = Layer.effect(
  GooglePlaces,
  googleMapsConfig.pipe(Effect.map(makeGooglePlaces)),
);

export const makeGooglePlacesTest = (implementation: Context.Tag.Service<GooglePlaces>) =>
  Layer.succeed(GooglePlaces, implementation);
