import { GooglePlaces } from "@repo/google";
import { Cause, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { authErrorToResponse, authenticate, handleNever, requirePermissions } from "@/api/lib/effect-auth";
import { requestValidationErrorToResponse } from "@/api/lib/schema-validator";
import { validateGooglePlaceLookupInput, validatePlaceSuggestionsInput } from "./geocoding.validator";

const unexpected = (c: HonoContext<HonoEnv>) =>
  c.json({ error: { code: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected server error." } }, 500);

const toPublicGooglePlaceResponse = (place: {
  googlePlaceId: string;
  formattedAddress: string | null;
  city: string | null;
  stateProvince: string | null;
  stateProvinceCode: string | null;
  country: string | null;
  countryCode: string | null;
  postalCode: string | null;
}) => ({
  googlePlaceId: place.googlePlaceId,
  formattedAddress: place.formattedAddress,
  city: place.city,
  stateProvince: place.stateProvince,
  stateProvinceCode: place.stateProvinceCode,
  country: place.country,
  countryCode: place.countryCode,
  postalCode: place.postalCode,
});

export const lookupGooglePlaceProgram = (headers: Headers, input: unknown) =>
  Effect.gen(function*() {
    const params = yield* validateGooglePlaceLookupInput(input);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { profile: ["read"] })(authenticated);
    const googlePlaces = yield* GooglePlaces;

    const place = yield* googlePlaces.lookupPlaceById(params.placeId);

    return toPublicGooglePlaceResponse(place);
  });

export const placeSuggestionsProgram = (headers: Headers, input: unknown) =>
  Effect.gen(function*() {
    const params = yield* validatePlaceSuggestionsInput(input);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { profile: ["read"] })(authenticated);
    const googlePlaces = yield* GooglePlaces;

    const suggestions = yield* googlePlaces.autocompletePlaces(params.query);

    return { suggestions };
  });

export type GeocodingRouteError =
  | Effect.Effect.Error<ReturnType<typeof lookupGooglePlaceProgram>>
  | Effect.Effect.Error<ReturnType<typeof placeSuggestionsProgram>>;

const geocodingErrorToResponse = (c: HonoContext<HonoEnv>, error: GeocodingRouteError) => {
  switch (error._tag) {
    case "UnauthorizedError":
    case "ForbiddenError":
    case "AuthProviderError":
    case "AuthEntityLookupError":
      return authErrorToResponse(c, error);
    case "RequestValidationError":
      return requestValidationErrorToResponse(c, error);
    case "GooglePlaceNotFoundError":
      return c.json({ error: { code: "GOOGLE_PLACE_NOT_FOUND" as const, message: "Google place was not found." } }, 404);
    case "GooglePlaceInvalidError":
      return c.json({ error: { code: "GOOGLE_PLACE_INVALID" as const, message: error.message } }, 422);
    case "GooglePlacesError":
      return c.json({ error: { code: "GOOGLE_PLACES_LOOKUP_FAILED" as const, message: "Unable to look up Google place." } }, 502);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, GeocodingRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        return geocodingErrorToResponse(c, failure.value);
      }

      return unexpected(c);
    },
  });

export async function placeSuggestionsHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const query = c.req.query("query");
  const exit = await runtime.runPromiseExit(
    placeSuggestionsProgram(headers, { query }),
  );

  return exitToResponse(c, exit);
}

export async function lookupGooglePlaceHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const placeId = c.req.query("placeId");
  const exit = await runtime.runPromiseExit(
    lookupGooglePlaceProgram(headers, { placeId }),
  );

  return exitToResponse(c, exit);
}
