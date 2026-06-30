import { googleMapsConfig } from "@repo/env";
import { Context, Data, Effect, Layer } from "effect";

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

export class GooglePlacesError extends Data.TaggedError("GooglePlacesError")<{
  operation: "placeDetails";
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
  }
>() { }

type AddressComponent = {
  long_name: string;
  short_name: string;
  types: Array<string>;
};

type PlaceDetailsResponse = {
  status: string;
  error_message?: string;
  result?: {
    place_id?: string;
    formatted_address?: string;
    address_components?: Array<AddressComponent>;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  };
};

const findComponent = (components: Array<AddressComponent>, type: string) =>
  components.find((component) => component.types.includes(type)) ?? null;

const getCity = (components: Array<AddressComponent>) =>
  findComponent(components, "locality") ??
  findComponent(components, "postal_town") ??
  findComponent(components, "administrative_area_level_3") ??
  findComponent(components, "administrative_area_level_2");

const normalizePlaceDetails = (placeId: string, response: PlaceDetailsResponse) => {
  if (response.status === "NOT_FOUND" || response.status === "ZERO_RESULTS") {
    return Effect.fail(new GooglePlaceNotFoundError({ placeId }));
  }

  if (response.status !== "OK") {
    return Effect.fail(
      new GooglePlacesError({
        operation: "placeDetails",
        placeId,
        cause: response.error_message ?? response.status,
      }),
    );
  }

  const result = response.result;
  const latitude = result?.geometry?.location?.lat;
  const longitude = result?.geometry?.location?.lng;

  if (!result) {
    return Effect.fail(new GooglePlaceInvalidError({ placeId, message: "Google place is missing result data." }));
  }

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return Effect.fail(new GooglePlaceInvalidError({ placeId, message: "Google place is missing coordinates." }));
  }

  const components = result.address_components ?? [];
  const city = getCity(components);
  const stateProvince = findComponent(components, "administrative_area_level_1");
  const country = findComponent(components, "country");
  const postalCode = findComponent(components, "postal_code");

  return Effect.succeed({
    googlePlaceId: result.place_id ?? placeId,
    formattedAddress: result.formatted_address ?? null,
    city: city?.long_name ?? null,
    stateProvince: stateProvince?.long_name ?? null,
    stateProvinceCode: stateProvince?.short_name ?? null,
    country: country?.long_name ?? null,
    countryCode: country?.short_name ?? null,
    postalCode: postalCode?.long_name ?? null,
    latitude,
    longitude,
  });
};

const makeGooglePlaces = (config: { apiKey: string }): Context.Tag.Service<GooglePlaces> => ({
  lookupPlaceById: (placeId) =>
    Effect.gen(function*() {
      const response = yield* Effect.tryPromise({
        try: async () => {
          const params = new URLSearchParams({
            place_id: placeId,
            fields: "place_id,geometry,address_component,formatted_address",
            key: config.apiKey,
          });
          const response = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`);

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
          cause instanceof GooglePlacesError
            ? cause
            : new GooglePlacesError({ operation: "placeDetails", placeId, cause }),
      });

      return yield* normalizePlaceDetails(placeId, response);
    }),
});

export const GooglePlacesLive = Layer.effect(
  GooglePlaces,
  googleMapsConfig.pipe(Effect.map(makeGooglePlaces)),
);

export const makeGooglePlacesTest = (implementation: Context.Tag.Service<GooglePlaces>) =>
  Layer.succeed(GooglePlaces, implementation);
