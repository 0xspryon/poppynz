import { SqlError } from "@effect/sql/SqlError";
import {
  DBNotFoundError,
  makeApprovalRepoTest,
  makeApprovalRequestRepoTest,
  makeKycDocumentRepoTest,
  makeKycDocumentTypeRepoTest,
  makeServiceOfferedRepoTest,
  makeUserProfileRepoTest,
  type Approval,
  type ApprovalCreateInput,
  type ApprovalRequest,
  type KycDocument,
  type KycDocumentType,
  type SafeUserProfile,
  type ServiceOffered,
  type UserProfile,
  type UserProfileLocationUpdate,
  type UserProfileUpdate,
} from "@repo/db";
import { makeGooglePlacesTest, type GooglePlaceLocation } from "@repo/google";
import { makeObjectStorageTest, ObjectStorageError } from "@repo/objs";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { beforeEach, describe, expect, it } from "vitest";
import type { UserAndSession } from "@/api/lib/effect-auth";
import { getProfileProgram, ProfileNotFoundError, ProfileRepoError, updateProfileLocationProgram, updateProfileProgram } from "./profile.handler";

const userAndSession: UserAndSession = {
  user: {
    id: "user-1",
    name: "Provider User",
    email: "provider@example.com",
    emailVerified: true,
    image: null,
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    updatedAt: new Date("2026-06-12T00:00:00.000Z"),
    isAnonymous: false,
    role: "service-provider",
    banned: false,
    banReason: null,
    banExpires: null,
    phoneNumber: null,
    phoneNumberVerified: null,
  },
  session: {
    id: "session-1",
    expiresAt: new Date("2026-06-13T00:00:00.000Z"),
    token: "token",
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    updatedAt: new Date("2026-06-12T00:00:00.000Z"),
    ipAddress: null,
    userAgent: null,
    userId: "user-1",
    impersonatedBy: null,
    activeOrganizationId: null,
  },
};

const profile = (overrides: Partial<SafeUserProfile> = {}): SafeUserProfile => ({
  userId: "user-1",
  email: "provider@example.com",
  role: "service-provider",
  image: null,
  language: "en",
  firstName: "Provider",
  lastName: "User",
  gender: "female",
  phoneNumber: "555-0101",
  dateOfBirth: "1980-05-21",
  address: "123 Main Street",
  city: "Toronto",
  postalCode: "M5H 1A1",
  country: "Canada",
  stateProvince: "Ontario",
  shortBio: "Provider profile",
  googlePlaceId: null,
  latitude: null,
  longitude: null,
  ...overrides,
});

const googleLocation = (overrides: Partial<GooglePlaceLocation> = {}): GooglePlaceLocation => ({
  googlePlaceId: "place-1",
  formattedAddress: "123 Main St, Toronto, ON, Canada",
  city: "Toronto",
  stateProvince: "Ontario",
  stateProvinceCode: "ON",
  country: "Canada",
  countryCode: "CA",
  postalCode: "M5H 1A1",
  latitude: 43.6532,
  longitude: -79.3832,
  ...overrides,
});

const approval = (overrides: Partial<Approval> = {}): Approval => ({
  id: "approval-1",
  userId: "user-1",
  approvalRequestId: "request-1",
  approvedBy: "admin-1",
  status: "approved",
  reason: null,
  expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  notifiedExpiresInOneMonthAt: null,
  notifiedExpiresInTwoWeeksAt: null,
  notifiedExpiresInOneWeekAt: null,
  notifiedExpiresInTwoDaysAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const approvalRequest = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: "request-1",
  userId: "user-1",
  status: "submitted",
  reviewedBy: null,
  reviewedAt: null,
  reason: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const documentType = (overrides: Partial<KycDocumentType> = {}): KycDocumentType => ({
  id: "document-type-1",
  name: "Government ID",
  appliesToRole: "service-provider",
  isOptional: false,
  requiresExpiryDate: true,
  deletedAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const kycDocument = (overrides: Partial<KycDocument> = {}): KycDocument => ({
  id: "kyc-document-1",
  userId: "user-1",
  documentTypeId: "document-type-1",
  filename: "government-id.pdf",
  fileKey: "users/user-1/kyc/document-type-1/government-id.pdf",
  expiryDate: new Date("2027-01-01T00:00:00.000Z"),
  status: "submitted",
  reason: null,
  deletedAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const service = (overrides: Partial<ServiceOffered> = {}): ServiceOffered => ({
  id: "service-1",
  userId: "user-1",
  name: "Childcare",
  description: "After school care",
  hourlyRateCents: 2500,
  currency: "CAD",
  deletedAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected effect to fail");
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error("Expected typed failure");
  return failure.value;
};

const makeLayer = (options: {
  profile?: SafeUserProfile | null;
  profileError?: SqlError;
  approval?: Approval | null;
  approvalRequest?: ApprovalRequest | null;
  documentTypes?: Array<KycDocumentType>;
  documents?: Array<KycDocument>;
  services?: Array<ServiceOffered>;
  onUpdate?: (input: UserProfileUpdate) => void;
  onLocationUpdate?: (input: UserProfileLocationUpdate) => void;
  googleLocation?: GooglePlaceLocation;
  imageUrlError?: ObjectStorageError;
} = {}) => {
  let currentProfile = options.profile === undefined ? profile() : options.profile;
  const documentTypes = options.documentTypes ?? [documentType(), documentType({ id: "optional-doc", name: "Driving License", isOptional: true })];

  return Layer.mergeAll(
    makeUserProfileRepoTest({
      create: (input: { userId: string; language: string }) => Effect.succeed({ ...profile(), userId: input.userId, language: input.language } as UserProfile),
      findByUserId: (userId) => {
        if (options.profileError) return Effect.fail(options.profileError);
        return currentProfile?.userId === userId ? Effect.succeed(currentProfile) : Effect.fail(new DBNotFoundError({ entity: "userProfile", value: userId }));
      },
      updateByUserId: (userId, input) => {
        options.onUpdate?.(input);
        if (!currentProfile || currentProfile.userId !== userId) return Effect.fail(new DBNotFoundError({ entity: "userProfile", value: userId }));
        currentProfile = { ...currentProfile, ...input };
        return Effect.succeed(currentProfile);
      },
      updateLocationByUserId: (userId, input) => {
        options.onLocationUpdate?.(input);
        if (!currentProfile || currentProfile.userId !== userId) return Effect.fail(new DBNotFoundError({ entity: "userProfile", value: userId }));
        currentProfile = { ...currentProfile, ...input };
        return Effect.succeed(currentProfile);
      },
    }),
    makeApprovalRepoTest({
      create: (input: ApprovalCreateInput) => Effect.succeed(approval(input)),
      findCurrentByUserId: (userId) => options.approval === null ? Effect.fail(new DBNotFoundError({ entity: "approval", value: userId })) : Effect.succeed(options.approval ?? approval({ userId })),
      listByUserId: () => Effect.succeed([]),
      revoke: (id) => Effect.fail(new DBNotFoundError({ entity: "approval", value: id })),
    }),
    makeApprovalRequestRepoTest({
      createSubmitted: (userId) => Effect.succeed(approvalRequest({ userId })),
      list: () => Effect.succeed([]),
      listWithApplicant: () => Effect.succeed([]),
      countByStatus: () => Effect.succeed({ submitted: 0, approved: 0, rejected: 0 }),
      listByUserId: () => Effect.succeed([]),
      findById: (id) => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id })),
      findSubmittedByUserId: (userId) => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: userId })),
      findLatestByUserId: (userId) => options.approvalRequest === null ? Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: userId })) : Effect.succeed(options.approvalRequest ?? approvalRequest({ userId })),
      markApproved: (id) => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id })),
      reject: (id) => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id })),
    }),
    makeKycDocumentTypeRepoTest({
      listActive: () => Effect.succeed(documentTypes),
      findActiveById: (id) => Effect.fail(new DBNotFoundError({ entity: "kycDocumentType", value: id })),
      create: () => Effect.succeed(documentType()),
      update: () => Effect.succeed(documentType()),
      softDelete: () => Effect.succeed(documentType({ deletedAt: new Date() })),
    }),
    makeKycDocumentRepoTest({
      findByIdWithType: (id) => Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: id })),
      findByUserId: () => Effect.succeed(options.documents ?? [kycDocument()]),
      findByUserIdWithTypes: () => Effect.succeed([]),
      submit: () => Effect.fail(new SqlError({ message: "not used" })),
      updateExpiryDate: (id) => Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: id })),
      approveSubmittedByUserId: () => Effect.succeed([]),
    }),
    makeServiceOfferedRepoTest({
      listByUserId: () => Effect.succeed(options.services ?? [service()]),
      create: () => Effect.fail(new SqlError({ message: "not used" })),
      updateByIdForUser: (id) => Effect.fail(new DBNotFoundError({ entity: "serviceOffered", value: id })),
      softDeleteByIdForUser: (id) => Effect.fail(new DBNotFoundError({ entity: "serviceOffered", value: id })),
    }),
    makeGooglePlacesTest({
      lookupPlaceById: () => Effect.succeed(options.googleLocation ?? googleLocation()),
      autocompletePlaces: () => Effect.succeed([]),
    }),
    makeObjectStorageTest({
      ensureBucketExists: () => Effect.void,
      ensurePublicReadBucket: () => Effect.void,
      createPresignedPutUrl: () => Effect.fail(new ObjectStorageError({ operation: "presignPutObject", bucket: "unused", cause: "not used" })),
      createPresignedGetUrl: (input) => options.imageUrlError
        ? Effect.fail(options.imageUrlError)
        : Effect.succeed({ url: `https://files.example.com/${input.bucket}/${input.key}?sig=test`, expiresAt: new Date("2026-06-12T00:05:00.000Z") }),
    }),
  );
};

describe("profile programs", () => {
  beforeEach(() => {
    process.env.OBJS_KYC_BUCKET = "kyc-documents";
    process.env.OBJS_PUBLIC_BUCKET = "public-assets";
  });

  it("replaces the stored image key with a presigned URL", async () => {
    const result = await Effect.runPromise(
      getProfileProgram(userAndSession).pipe(
        Effect.provide(makeLayer({ profile: profile({ image: "users/user-1/public/profile-pictures/pic.png" }) })),
      ),
    );

    expect(result.image).toBe(
      "https://files.example.com/public-assets/users/user-1/public/profile-pictures/pic.png?sig=test",
    );
  });

  it("returns a null image when no profile picture is stored", async () => {
    const result = await Effect.runPromise(getProfileProgram(userAndSession).pipe(Effect.provide(makeLayer())));

    expect(result.image).toBeNull();
  });

  it("translates image presign failures to ProfileImageUrlError", async () => {
    const exit = await Effect.runPromise(
      getProfileProgram(userAndSession).pipe(
        Effect.provide(makeLayer({
          profile: profile({ image: "users/user-1/public/profile-pictures/pic.png" }),
          imageUrlError: new ObjectStorageError({ operation: "presignGetObject", bucket: "public-assets", cause: "down" }),
        })),
        Effect.exit,
      ),
    );

    expect(getFailure(exit)._tag).toBe("ProfileImageUrlError");
  });

  it("returns service-provider onboarding state", async () => {
    const result = await Effect.runPromise(getProfileProgram(userAndSession).pipe(Effect.provide(makeLayer())));

    expect(result).toMatchObject({
      userId: "user-1",
      approval: { id: "approval-1", approvalRequestId: "request-1", expiresAt: "2027-01-01T00:00:00.000Z" },
      latestApprovalRequest: { id: "request-1", status: "submitted" },
      warnings: { missingRequiredDocuments: [], missingServicesOffered: false },
    });
    expect(result.kycDocuments).toEqual([expect.objectContaining({ id: "kyc-document-1" })]);
    expect(result.optionalDocumentTypes).toEqual([{ id: "optional-doc", name: "Driving License" }]);
  });

  it("returns missing onboarding warnings", async () => {
    const result = await Effect.runPromise(getProfileProgram(userAndSession).pipe(Effect.provide(makeLayer({ documents: [], services: [] }))));

    expect(result.missingRequiredDocuments).toEqual([{ documentTypeId: "document-type-1", name: "Government ID" }]);
    expect(result.warnings?.missingServicesOffered).toBe(true);
  });

  it("omits service-provider onboarding state for family users", async () => {
    const result = await Effect.runPromise(getProfileProgram(userAndSession).pipe(Effect.provide(makeLayer({ profile: profile({ role: "family" }) }))));

    expect(result.role).toBe("family");
    expect(result).not.toHaveProperty("kycDocuments");
    expect(result).not.toHaveProperty("servicesOffered");
  });

  it("updates profile fields", async () => {
    const updates: Array<UserProfileUpdate> = [];
    const result = await Effect.runPromise(
      updateProfileProgram(userAndSession, { firstName: "Updated" }).pipe(
        Effect.provide(makeLayer({ onUpdate: (input) => updates.push(input) })),
      ),
    );

    expect(result.firstName).toBe("Updated");
    expect(updates).toEqual([{ firstName: "Updated" }]);
  });

  it("updates profile location from a Google place", async () => {
    const updates: Array<UserProfileLocationUpdate> = [];
    const result = await Effect.runPromise(
      updateProfileLocationProgram(userAndSession, { googlePlaceId: "place-1" }).pipe(
        Effect.provide(makeLayer({ onLocationUpdate: (input) => updates.push(input) })),
      ),
    );

    expect(result).toMatchObject({
      googlePlaceId: "place-1",
      city: "Toronto",
      stateProvince: "ON",
      country: "CA",
    });
    expect(result).not.toHaveProperty("latitude");
    expect(result).not.toHaveProperty("longitude");
    expect(updates).toEqual([
      expect.objectContaining({
        googlePlaceId: "place-1",
        latitude: 43.6532,
        longitude: -79.3832,
      }),
    ]);
  });

  it("translates missing profile to ProfileNotFoundError", async () => {
    const exit = await Effect.runPromise(getProfileProgram(userAndSession).pipe(Effect.provide(makeLayer({ profile: null })), Effect.exit));
    expect(getFailure(exit)).toBeInstanceOf(ProfileNotFoundError);
  });

  it("translates profile SQL failures to ProfileRepoError", async () => {
    const exit = await Effect.runPromise(getProfileProgram(userAndSession).pipe(Effect.provide(makeLayer({ profileError: new SqlError({ message: "db down" }) })), Effect.exit));
    expect(getFailure(exit)).toBeInstanceOf(ProfileRepoError);
  });
});
