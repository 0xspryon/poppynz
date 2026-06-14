import type { SqlError } from "@effect/sql/SqlError";
import { SafeUserProfile, UserProfileRepo } from "@repo/db";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "../../../app-env";
import {
  AuthError,
  authenticate,
  isAuthError,
  Principal,
  requirePermissions,
} from "../../../lib/effect-auth";
import type { ProfileUpdateInput } from "./profile.validator";

export class ProfileRepoError extends Data.TaggedError("ProfileRepoError")<{
  cause: SqlError;
}> {}

export class ProfileNotFoundError extends Data.TaggedError("ProfileNotFoundError")<{}> {}

export type ProfileError = ProfileRepoError | ProfileNotFoundError;

const toProfileResponse = (profile: SafeUserProfile) => ({
  userId: profile.userId,
  email: profile.email,
  role: profile.role,
  language: profile.language,
  firstName: profile.firstName,
  lastName: profile.lastName,
  gender: profile.gender,
  phoneNumber: profile.phoneNumber,
  dateOfBirth: profile.dateOfBirth,
  address: profile.address,
  city: profile.city,
  postalCode: profile.postalCode,
  country: profile.country,
  stateProvince: profile.stateProvince,
  shortBio: profile.shortBio,
});

export const getProfileProgram = (principal: Principal) =>
  Effect.gen(function* () {
    const profileRepo = yield* UserProfileRepo;

    const profile = yield* profileRepo
      .findByUserId(principal.user.id)
      .pipe(Effect.mapError((cause) => new ProfileRepoError({ cause })));

    if (!profile) {
      return yield* Effect.fail(new ProfileNotFoundError());
    }

    return toProfileResponse(profile);
  });

export const updateProfileProgram = (principal: Principal, input: ProfileUpdateInput) =>
  Effect.gen(function* () {
    const profileRepo = yield* UserProfileRepo;

    const profile = yield* profileRepo
      .updateByUserId(principal.user.id, input)
      .pipe(Effect.mapError((cause) => new ProfileRepoError({ cause })));

    if (!profile) {
      return yield* Effect.fail(new ProfileNotFoundError());
    }

    return toProfileResponse(profile);
  });

const profileErrorToResponse = (c: HonoContext<HonoEnv>, error: ProfileError) => {
  switch (error._tag) {
    case "ProfileRepoError":
      return c.json(
        {
          error: {
            code: "PROFILE_LOOKUP_FAILED" as const,
            message: "Unable to load profile.",
          },
        },
        500,
      );
    case "ProfileNotFoundError":
      return c.json(
        {
          error: {
            code: "PROFILE_NOT_FOUND" as const,
            message: "Profile was not found.",
          },
        },
        404,
      );
  }
};

const authErrorToResponse = (c: HonoContext<HonoEnv>, error: AuthError) => {
  switch (error._tag) {
    case "UnauthorizedError":
      return c.json(
        {
          error: {
            code: "UNAUTHORIZED" as const,
            message: "Authentication is required.",
          },
        },
        401,
      );
    case "ForbiddenError":
      return c.json(
        {
          error: {
            code: "FORBIDDEN" as const,
            message: "You do not have permission to access this resource.",
          },
        },
        403,
      );
    case "AuthProviderError":
      return c.json(
        {
          error: {
            code: "AUTH_PROVIDER_FAILED" as const,
            message: "Unable to verify authentication.",
          },
        },
        500,
      );
    case "AuthEntityLookupError":
      return c.json(
        {
          error: {
            code: "AUTH_ENTITY_LOOKUP_FAILED" as const,
            message: "Unable to verify authentication.",
          },
        },
        500,
      );
  }
};

const unexpectedErrorResponse = (c: HonoContext<HonoEnv>) =>
  c.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR" as const,
        message: "Unexpected server error.",
      },
    },
    500,
  );

const isProfileError = (error: unknown): error is ProfileError =>
  error instanceof ProfileRepoError || error instanceof ProfileNotFoundError;

const exitToResponse = <TProfile>(c: HonoContext<HonoEnv>, exit: Exit.Exit<TProfile, unknown>) =>
  Exit.match(exit, {
    onSuccess: (profile) => c.json(profile),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        if (isAuthError(failure.value)) {
          return authErrorToResponse(c, failure.value);
        }

        if (isProfileError(failure.value)) {
          return profileErrorToResponse(c, failure.value);
        }
      }

      return unexpectedErrorResponse(c);
    },
  });

export async function getProfileHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    authenticate(headers).pipe(
      Effect.flatMap(requirePermissions(headers, { profile: ["read"] })),
      Effect.flatMap(getProfileProgram),
    ),
  );

  return exitToResponse(c, exit);
}

export async function updateProfileHandler(c: HonoContext<HonoEnv>, body: ProfileUpdateInput) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    authenticate(headers).pipe(
      Effect.flatMap(requirePermissions(headers, { profile: ["update"] })),
      Effect.flatMap((principal) => updateProfileProgram(principal, body)),
    ),
  );

  return exitToResponse(c, exit);
}
