import type { SqlError } from "@effect/sql/SqlError";
import {
 Approval,
 ApprovalRepo,
 KycDocument,
 KycDocumentRepo,
 SafeUserProfile,
 UserProfileRepo,
} from "@repo/db";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "../../../app-env";
import {
  authenticate,
  isAuthError,
  Principal,
  requirePermissions,
  authErrorToResponse,
} from "@/api/lib/effect-auth";
import type { ProfileUpdateInput } from "./profile.validator";

export class ProfileRepoError extends Data.TaggedError("ProfileRepoError")<{
  cause: SqlError;
}> {}

export class ProfileNotFoundError extends Data.TaggedError("ProfileNotFoundError")<{}> {}

export type ProfileError = ProfileRepoError | ProfileNotFoundError;

type ProfileApprovalType = "family" | "service-provider";

const toProfileApprovalType = (role: string | null): ProfileApprovalType | null =>
  role === "family" || role === "service-provider" ? role : null;

const toApprovalSummary = (type: ProfileApprovalType, approval: Approval | null) => ({
  type,
  status: approval?.status ?? "pending",
  reason: approval?.reason ?? null,
});

const toKycDocumentResponse = (document: KycDocument) => ({
  id: document.id,
  type: document.type,
  filename: document.filename,
  status: document.status,
  reason: document.reason,
});

const toProfileResponse = (
  profile: SafeUserProfile,
  approval: ReturnType<typeof toApprovalSummary> | null,
  kycDocuments: Array<KycDocument>,
) => ({
  userId: profile.userId,
  email: profile.email,
  role: profile.role,
  approval,
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
  ...(
    profile.role === "service-provider"
    ? { kycDocuments: kycDocuments.map(toKycDocumentResponse) }
    : {}
  ),
});

const buildProfileResponse = (profile: SafeUserProfile) =>
  Effect.gen(function* () {
    const approvalRepo = yield* ApprovalRepo;
    const kycDocumentRepo = yield* KycDocumentRepo;
    const approvalType = toProfileApprovalType(profile.role);
    const approval = approvalType
      ? yield* approvalRepo
        .findByUserIdAndType(profile.userId, approvalType)
        .pipe(
          Effect.catchTags({
            DBNotFoundError: () => Effect.succeed(null),
            SqlError: (cause) => Effect.fail(new ProfileRepoError({ cause }))
          })
        )
      : null;
    const kycDocuments = profile.role === "service-provider"
      ? yield* kycDocumentRepo
        .findByUserId(profile.userId)
        .pipe(Effect.mapError((cause) => new ProfileRepoError({ cause })))
      : [];

    return toProfileResponse(
      profile,
      approvalType ? toApprovalSummary(approvalType, approval) : null,
      kycDocuments,
    );
  });

export const getProfileProgram = (principal: Principal) =>
  UserProfileRepo.pipe(
    Effect.flatMap(
      (profileRepo) =>
        profileRepo
          .findByUserId(principal.user.id)
          .pipe(
            Effect.catchTags({
              DBNotFoundError: () => Effect.fail(new ProfileNotFoundError()),
              SqlError: (cause) => Effect.fail(new ProfileRepoError({ cause }))
            }),
            Effect.flatMap(buildProfileResponse)
          )
    )
  )

export const updateProfileProgram = (principal: Principal, input: ProfileUpdateInput) =>
  UserProfileRepo.pipe(
    Effect.flatMap(
      (profileRepo) =>
        profileRepo
          .updateByUserId(principal.user.id, input)
          .pipe(
            Effect.catchTags({
              DBNotFoundError: () => Effect.fail(new ProfileNotFoundError()),
              SqlError: (cause) => Effect.fail(new ProfileRepoError({ cause }))
            }),
            Effect.flatMap(buildProfileResponse)
          )
    )
  )

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
