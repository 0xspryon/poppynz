import type { SqlError } from '@effect/sql/SqlError';
import {
  type Approval,
  ApprovalRepo,
  type ApprovalRequest,
  ApprovalRequestRepo,
  type KycDocument,
  KycDocumentRepo,
  KycDocumentTypeRepo,
  type SafeUserProfile,
  type ServiceOffered,
  ServiceOfferedRepo,
  UserProfileRepo
} from '@repo/db';
import { GooglePlaces } from '@repo/google';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '../../../app-env';
import {
  authenticate,
  type UserAndSession,
  requirePermissions,
  authErrorToResponse,
  handleNever
} from '@/api/lib/effect-auth';
import {
  profileUpdateJsonError,
  validateProfileUpdateInput,
  validateProfileLocationUpdateInput,
  type ProfileUpdateInput,
  type ProfileLocationUpdateInput
} from './profile.validator';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import { presignProfileImageUrl } from '@/api/lib/profile-image';
import { scheduleFamilySearchReconcile } from '@/api/lib/family-search-jobs';
import { scheduleProviderSearchReconcile } from '@/api/lib/provider-search-jobs';

// Each role has its own search index; a profile edit reconciles the one the
// user can appear in.
const scheduleSearchReconcile = (profile: { userId: string; role: string | null }) =>
  profile.role === 'family'
    ? scheduleFamilySearchReconcile(profile.userId)
    : scheduleProviderSearchReconcile(profile.userId);

export class ProfileRepoError extends Data.TaggedError('ProfileRepoError')<{
  cause: SqlError;
}> {}

export class ProfileNotFoundError extends Data.TaggedError('ProfileNotFoundError')<{}> {}

const toApprovalSummary = (approval: Approval | null) =>
  approval
    ? {
        id: approval.id,
        approvalRequestId: approval.approvalRequestId,
        expiresAt: approval.expiresAt.toISOString()
      }
    : null;

const toApprovalRequestSummary = (request: ApprovalRequest | null) =>
  request
    ? {
        id: request.id,
        status: request.status,
        reason: request.reason,
        reviewedAt: request.reviewedAt?.toISOString() ?? null
      }
    : null;

const toKycDocumentResponse = (document: KycDocument) => ({
  id: document.id,
  documentTypeId: document.documentTypeId,
  filename: document.filename,
  expiryDate: document.expiryDate?.toISOString() ?? null,
  status: document.status,
  reason: document.reason
});

const toServiceOfferedResponse = (service: ServiceOffered) => ({
  id: service.id,
  name: service.name,
  description: service.description,
  hourlyRateCents: service.hourlyRateCents,
  currency: service.currency
});

const toProfileResponse = (
  profile: SafeUserProfile,
  imageUrl: string | null,
  approval: ReturnType<typeof toApprovalSummary>,
  latestApprovalRequest: ReturnType<typeof toApprovalRequestSummary>,
  kycDocuments: Array<KycDocument>,
  servicesOffered: Array<ServiceOffered>,
  missingRequiredDocuments: Array<{ documentTypeId: string; name: string }>,
  optionalDocumentTypes: Array<{ id: string; name: string }>
) => ({
  userId: profile.userId,
  email: profile.email,
  role: profile.role,
  image: imageUrl,
  approval,
  latestApprovalRequest,
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
  googlePlaceId: profile.googlePlaceId,
  ...(profile.role === 'service-provider'
    ? {
        kycDocuments: kycDocuments.map(toKycDocumentResponse),
        missingRequiredDocuments,
        optionalDocumentTypes,
        servicesOffered: servicesOffered.map(toServiceOfferedResponse),
        warnings: {
          missingRequiredDocuments,
          missingServicesOffered: servicesOffered.length === 0
        }
      }
    : {})
});

const buildProfileResponse = (profile: SafeUserProfile) =>
  Effect.gen(function* () {
    const approvalRepo = yield* ApprovalRepo;
    const approvalRequestRepo = yield* ApprovalRequestRepo;
    const kycDocumentRepo = yield* KycDocumentRepo;
    const kycDocumentTypeRepo = yield* KycDocumentTypeRepo;
    const serviceOfferedRepo = yield* ServiceOfferedRepo;
    const approval =
      profile.role === 'service-provider'
        ? yield* approvalRepo.findCurrentByUserId(profile.userId).pipe(
            Effect.catchTags({
              DBNotFoundError: () => Effect.succeed(null),
              SqlError: (cause) => Effect.fail(new ProfileRepoError({ cause }))
            })
          )
        : null;
    const latestApprovalRequest =
      profile.role === 'service-provider'
        ? yield* approvalRequestRepo.findLatestByUserId(profile.userId).pipe(
            Effect.catchTags({
              DBNotFoundError: () => Effect.succeed(null),
              SqlError: (cause) => Effect.fail(new ProfileRepoError({ cause }))
            })
          )
        : null;
    const kycDocuments =
      profile.role === 'service-provider'
        ? yield* kycDocumentRepo
            .findByUserId(profile.userId)
            .pipe(Effect.mapError((cause) => new ProfileRepoError({ cause })))
        : [];
    const [documentTypes, servicesOffered] =
      profile.role === 'service-provider'
        ? yield* Effect.all(
            [
              kycDocumentTypeRepo
                .listActive()
                .pipe(Effect.mapError((cause) => new ProfileRepoError({ cause }))),
              serviceOfferedRepo
                .listByUserId(profile.userId)
                .pipe(Effect.mapError((cause) => new ProfileRepoError({ cause })))
            ],
            { concurrency: 'unbounded' }
          )
        : [[], []];
    const submittedDocumentTypeIds = new Set(
      kycDocuments.map((document) => document.documentTypeId)
    );
    const missingRequiredDocuments = documentTypes
      .filter(
        (type) =>
          type.appliesToRole === 'service-provider' &&
          !type.isOptional &&
          !submittedDocumentTypeIds.has(type.id)
      )
      .map((type) => ({ documentTypeId: type.id, name: type.name }));
    const optionalDocumentTypes = documentTypes
      .filter((type) => type.appliesToRole === 'service-provider' && type.isOptional)
      .map((type) => ({ id: type.id, name: type.name }));
    const imageUrl = yield* presignProfileImageUrl(profile.image);

    return toProfileResponse(
      profile,
      imageUrl,
      toApprovalSummary(approval),
      toApprovalRequestSummary(latestApprovalRequest),
      kycDocuments,
      servicesOffered,
      missingRequiredDocuments,
      optionalDocumentTypes
    );
  });

export const getProfileProgram = (userAndSession: UserAndSession) =>
  UserProfileRepo.pipe(
    Effect.flatMap((profileRepo) =>
      profileRepo.findByUserId(userAndSession.user.id).pipe(
        Effect.catchTags({
          DBNotFoundError: () => Effect.fail(new ProfileNotFoundError()),
          SqlError: (cause) => Effect.fail(new ProfileRepoError({ cause }))
        }),
        Effect.flatMap(buildProfileResponse)
      )
    )
  );

export const updateProfileProgram = (userAndSession: UserAndSession, input: ProfileUpdateInput) =>
  UserProfileRepo.pipe(
    Effect.flatMap((profileRepo) =>
      profileRepo.updateByUserId(userAndSession.user.id, input).pipe(
        Effect.catchTags({
          DBNotFoundError: () => Effect.fail(new ProfileNotFoundError()),
          SqlError: (cause) => Effect.fail(new ProfileRepoError({ cause }))
        }),
        Effect.flatMap(buildProfileResponse)
      )
    )
  );

export const updateProfileLocationProgram = (
  userAndSession: UserAndSession,
  input: ProfileLocationUpdateInput
) =>
  Effect.gen(function* () {
    const profileRepo = yield* UserProfileRepo;
    const googlePlaces = yield* GooglePlaces;
    const location = yield* googlePlaces.lookupPlaceById(input.googlePlaceId);
    const profile = yield* profileRepo
      .updateLocationByUserId(userAndSession.user.id, {
        googlePlaceId: location.googlePlaceId,
        latitude: location.latitude,
        longitude: location.longitude,
        address: location.formattedAddress,
        city: location.city,
        postalCode: location.postalCode,
        country: location.countryCode ?? location.country,
        stateProvince: location.stateProvinceCode ?? location.stateProvince
      })
      .pipe(
        Effect.catchTags({
          DBNotFoundError: () => Effect.fail(new ProfileNotFoundError()),
          SqlError: (cause) => Effect.fail(new ProfileRepoError({ cause }))
        })
      );

    return yield* buildProfileResponse(profile);
  });

export type ProfileError =
  | Effect.Effect.Error<ReturnType<typeof getProfileProgram>>
  | Effect.Effect.Error<ReturnType<typeof updateProfileProgram>>
  | Effect.Effect.Error<ReturnType<typeof updateProfileLocationProgram>>;

const profileErrorToResponse = (c: HonoContext<HonoEnv>, error: ProfileError) => {
  switch (error._tag) {
    case 'ProfileRepoError':
      return c.json(
        {
          error: {
            code: 'PROFILE_LOOKUP_FAILED' as const,
            message: 'Unable to load profile.'
          }
        },
        500
      );
    case 'ProfileNotFoundError':
      return c.json(
        {
          error: {
            code: 'PROFILE_NOT_FOUND' as const,
            message: 'Profile was not found.'
          }
        },
        404
      );
    case 'ProfileImageUrlError':
      return c.json(
        {
          error: {
            code: 'PROFILE_IMAGE_URL_FAILED' as const,
            message: 'Unable to create a profile image link.'
          }
        },
        502
      );
    case 'GooglePlaceNotFoundError':
      return c.json(
        {
          error: { code: 'GOOGLE_PLACE_NOT_FOUND' as const, message: 'Google place was not found.' }
        },
        404
      );
    case 'GooglePlaceInvalidError':
      return c.json(
        { error: { code: 'GOOGLE_PLACE_INVALID' as const, message: error.message } },
        422
      );
    case 'GooglePlacesError':
      return c.json(
        {
          error: {
            code: 'GOOGLE_PLACES_LOOKUP_FAILED' as const,
            message: 'Unable to look up Google place.'
          }
        },
        502
      );
    default:
      return handleNever(c, error);
  }
};

const unexpectedErrorResponse = (c: HonoContext<HonoEnv>) =>
  c.json(
    {
      error: {
        code: 'INTERNAL_SERVER_ERROR' as const,
        message: 'Unexpected server error.'
      }
    },
    500
  );

export const getProfileRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      profile: ['read']
    })(authenticated);

    return yield* getProfileProgram(userAndSession);
  });

export const updateProfileRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, profileUpdateJsonError);
    const input = yield* validateProfileUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      profile: ['update']
    })(authenticated);

    const profile = yield* updateProfileProgram(userAndSession, input);
    yield* scheduleSearchReconcile(profile);

    return profile;
  });

export const updateProfileLocationRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, profileUpdateJsonError);
    const input = yield* validateProfileLocationUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      profile: ['update']
    })(authenticated);

    const profile = yield* updateProfileLocationProgram(userAndSession, input);
    yield* scheduleSearchReconcile(profile);

    return profile;
  });

export type ProfileRouteError =
  | Effect.Effect.Error<ReturnType<typeof getProfileRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof updateProfileRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof updateProfileLocationRouteProgram>>;

const profileRouteErrorToResponse = (c: HonoContext<HonoEnv>, error: ProfileRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'ProfileRepoError':
    case 'ProfileNotFoundError':
    case 'ProfileImageUrlError':
      return profileErrorToResponse(c, error);
    case 'GooglePlaceNotFoundError':
      return c.json(
        {
          error: { code: 'GOOGLE_PLACE_NOT_FOUND' as const, message: 'Google place was not found.' }
        },
        404
      );
    case 'GooglePlaceInvalidError':
      return c.json(
        { error: { code: 'GOOGLE_PLACE_INVALID' as const, message: error.message } },
        422
      );
    case 'GooglePlacesError':
      return c.json(
        {
          error: {
            code: 'GOOGLE_PLACES_LOOKUP_FAILED' as const,
            message: 'Unable to look up Google place.'
          }
        },
        502
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <TProfile>(
  c: HonoContext<HonoEnv>,
  exit: Exit.Exit<TProfile, ProfileRouteError>
) =>
  Exit.match(exit, {
    onSuccess: (profile) => c.json(profile),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        return profileRouteErrorToResponse(c, failure.value);
      }

      return unexpectedErrorResponse(c);
    }
  });

export async function getProfileHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(getProfileRouteProgram(headers));

  return exitToResponse(c, exit);
}

export async function updateProfileHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(updateProfileRouteProgram(c, headers));

  return exitToResponse(c, exit);
}

export async function updateProfileLocationHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(updateProfileLocationRouteProgram(c, headers));

  return exitToResponse(c, exit);
}
