import {
  DBNotFoundError,
  EmptySignupIntentRepoTest,
  makeApprovalRepoTest,
  makeApprovalRequestRepoTest,
  makeKycDocumentRepoTest,
  makeKycDocumentTypeRepoTest,
  makeServiceOfferedRepoTest,
  makeSessionRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  type Approval,
  type ApprovalCreateInput,
  type ApprovalRequest,
  type KycDocument,
  type KycDocumentType,
  type SafeUserProfile,
  type ServiceOffered,
  type Session,
  type User,
  type UserProfile,
  type UserProfileLocationUpdate,
  type UserProfileUpdate,
} from "@repo/db";
import { makeGooglePlacesTest } from "@repo/google";
import { Effect, Layer, ManagedRuntime } from "effect";
import { makeObjectStorageTest } from "@repo/objs";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../index";
import { makeAuthServiceTest, type AuthSession, type Permissions } from "../../../lib/effect-auth";
import { EmptySigninServiceTest } from "../auth/signin/signin.handler";
import { EmptySignupServiceTest } from "../auth/signup/signup.handler";

const makeProfile = (overrides: Partial<SafeUserProfile> = {}): SafeUserProfile => ({
  userId: "user-1",
  email: "provider@example.com",
  role: "service-provider",
  language: "en",
  firstName: "Springfield",
  lastName: "Mom Helper",
  gender: "female",
  phoneNumber: "(416)88052",
  dateOfBirth: "1980-05-21",
  address: "123 Main Street",
  city: "Toronto",
  postalCode: "M5H N12",
  country: "Canada",
  stateProvince: "Ontario",
  shortBio: "Mom helper profile",
  googlePlaceId: null,
  latitude: null,
  longitude: null,
  ...overrides,
});

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  name: "Mom Helper",
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
  ...overrides,
});

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  expiresAt: new Date("2026-06-13T00:00:00.000Z"),
  token: "session-token",
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ipAddress: null,
  userAgent: null,
  userId: "user-1",
  impersonatedBy: null,
  activeOrganizationId: null,
  ...overrides,
});

const makeApproval = (overrides: Partial<Approval> = {}): Approval => ({
  id: "approval-1",
  userId: "user-1",
  approvalRequestId: "request-1",
  approvedBy: "admin-1",
  status: "approved",
  reason: null,
  expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const makeApprovalRequest = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
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

const makeDocumentType = (overrides: Partial<KycDocumentType> = {}): KycDocumentType => ({
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

const makeKycDocument = (overrides: Partial<KycDocument> = {}): KycDocument => ({
  id: "kyc-document-1",
  userId: "user-1",
  documentTypeId: "document-type-1",
  filename: "government-id.pdf",
  fileKey: "private/government-id.pdf",
  expiryDate: new Date("2027-01-01T00:00:00.000Z"),
  status: "submitted",
  reason: null,
  deletedAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const makeServiceOffered = (overrides: Partial<ServiceOffered> = {}): ServiceOffered => ({
  id: "service-1",
  userId: "user-1",
  name: "After school babysitting",
  description: "Pickup and supervision.",
  hourlyRateCents: 2800,
  currency: "CAD",
  deletedAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const makeApp = (options: {
  authSession?: AuthSession | null;
  hasPermission?: boolean;
  user?: User | null;
  session?: Session | null;
  profile?: SafeUserProfile;
  approval?: Approval | null;
  approvalRequest?: ApprovalRequest | null;
  documentTypes?: Array<KycDocumentType>;
  kycDocuments?: Array<KycDocument>;
  servicesOffered?: Array<ServiceOffered>;
  onUpdate?: (input: UserProfileUpdate) => void;
  onLocationUpdate?: (input: UserProfileLocationUpdate) => void;
  onPermissionCheck?: (permissions: Permissions) => void;
} = {}) => {
  let profile = options.profile ?? makeProfile();
  const user = options.user === undefined ? makeUser({ id: profile.userId, email: profile.email, role: profile.role }) : options.user;
  const session = options.session === undefined ? makeSession({ userId: profile.userId }) : options.session;
  const approval = options.approval === undefined ? makeApproval({ userId: profile.userId }) : options.approval;
  const approvalRequest = options.approvalRequest === undefined ? makeApprovalRequest({ userId: profile.userId }) : options.approvalRequest;
  const documentTypes = options.documentTypes ?? [makeDocumentType(), makeDocumentType({ id: "optional-doc", name: "Driving License", isOptional: true })];
  const kycDocuments = options.kycDocuments ?? [makeKycDocument({ userId: profile.userId })];
  const servicesOffered = options.servicesOffered ?? [makeServiceOffered({ userId: profile.userId })];
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      EmptySignupIntentRepoTest,
      EmptySigninServiceTest,
      EmptySignupServiceTest,
      makeAuthServiceTest({
        getSession: () => Effect.succeed(options.authSession === undefined ? { user: { id: profile.userId }, session: { id: "session-1" } } : options.authSession),
        userHasPermission: (_headers, permissions) => {
          options.onPermissionCheck?.(permissions);
          return Effect.succeed(options.hasPermission ?? true);
        },
      }),
      makeUserRepoTest({
        findById: (id) => user?.id === id ? Effect.succeed(user) : Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
        findByEmail: () => user ? Effect.succeed(user) : Effect.fail(new DBNotFoundError({ entity: "user", value: "" })),
      }),
      makeSessionRepoTest({
        findById: (id) => session?.id === id ? Effect.succeed(session) : Effect.fail(new DBNotFoundError({ entity: "session", value: id })),
      }),
      makeUserProfileRepoTest({
        create: (input: { userId: string; language: string }) => Effect.succeed({ ...makeProfile(), userId: input.userId, language: input.language } as UserProfile),
        findByUserId: (userId) => profile.userId === userId ? Effect.succeed(profile) : Effect.fail(new DBNotFoundError({ entity: "userProfile", value: userId })),
        updateByUserId: (userId, input) => {
          options.onUpdate?.(input);
          profile = { ...profile, ...input };
          return profile.userId === userId ? Effect.succeed(profile) : Effect.fail(new DBNotFoundError({ entity: "userProfile", value: userId }));
        },
        updateLocationByUserId: (userId, input) => {
          options.onLocationUpdate?.(input);
          profile = { ...profile, ...input };
          return profile.userId === userId ? Effect.succeed(profile) : Effect.fail(new DBNotFoundError({ entity: "userProfile", value: userId }));
        },
      }),
      makeGooglePlacesTest({
        autocompletePlaces: () => Effect.succeed([]),
        lookupPlaceById: (placeId) => Effect.succeed({
          googlePlaceId: placeId,
          formattedAddress: "123 Main St, Toronto, ON, Canada",
          city: "Toronto",
          stateProvince: "Ontario",
          stateProvinceCode: "ON",
          country: "Canada",
          countryCode: "CA",
          postalCode: "M5H 1A1",
          latitude: 43.6532,
          longitude: -79.3832,
        }),
      }),
      makeApprovalRepoTest({
        create: (input: ApprovalCreateInput) => Effect.succeed(makeApproval(input)),
        findCurrentByUserId: (userId) => approval?.userId === userId ? Effect.succeed(approval) : Effect.fail(new DBNotFoundError({ entity: "approval", value: userId })),
        listByUserId: (userId) => Effect.succeed(approval?.userId === userId ? [approval] : []),
      }),
      makeApprovalRequestRepoTest({
        createSubmitted: (userId) => Effect.succeed(makeApprovalRequest({ userId })),
        list: () => Effect.succeed(approvalRequest ? [approvalRequest] : []),
        listWithApplicant: () => Effect.succeed([]),
        countByStatus: () => Effect.succeed({ submitted: 0, approved: 0, rejected: 0 }),
        listByUserId: (userId) => Effect.succeed(approvalRequest?.userId === userId ? [approvalRequest] : []),
        findById: (id) => approvalRequest?.id === id ? Effect.succeed(approvalRequest) : Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id })),
        findSubmittedByUserId: (userId) => approvalRequest?.userId === userId && approvalRequest.status === "submitted" ? Effect.succeed(approvalRequest) : Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: userId })),
        findLatestByUserId: (userId) => approvalRequest?.userId === userId ? Effect.succeed(approvalRequest) : Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: userId })),
        markApproved: (id) => approvalRequest?.id === id ? Effect.succeed({ ...approvalRequest, status: "approved" }) : Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id })),
        reject: (id) => approvalRequest?.id === id ? Effect.succeed({ ...approvalRequest, status: "rejected" }) : Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id })),
      }),
      makeObjectStorageTest({
        ensureBucketExists: () => Effect.void,
        ensurePublicReadBucket: () => Effect.void,
        createPresignedPutUrl: () => Effect.succeed({ uploadUrl: "https://example.com", expiresAt: new Date() }),
        createPresignedGetUrl: () => Effect.succeed({ url: "https://example.com", expiresAt: new Date() }),
      }),
      makeKycDocumentTypeRepoTest({
        listActive: () => Effect.succeed(documentTypes.filter((type) => type.deletedAt === null)),
        findActiveById: (id) => {
          const type = documentTypes.find((type) => type.id === id && type.deletedAt === null);
          return type ? Effect.succeed(type) : Effect.fail(new DBNotFoundError({ entity: "kycDocumentType", value: id }));
        },
        create: () => Effect.succeed(makeDocumentType()),
        update: () => Effect.succeed(makeDocumentType()),
        softDelete: () => Effect.succeed(makeDocumentType({ deletedAt: new Date() })),
      }),
      makeKycDocumentRepoTest({
        findByIdWithType: () => Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: "" })),
        findByUserId: (userId) => Effect.succeed(kycDocuments.filter((document) => document.userId === userId && document.deletedAt === null)),
        findByUserIdWithTypes: (userId) => Effect.succeed(kycDocuments.filter((document) => document.userId === userId).map((document) => ({ ...document, documentType: documentTypes.find((type) => type.id === document.documentTypeId)! }))),
        submit: () => Effect.succeed(makeKycDocument()),
        updateExpiryDate: () => Effect.succeed(makeKycDocument()),
        approveSubmittedByUserId: () => Effect.succeed([]),
      }),
      makeServiceOfferedRepoTest({
        listByUserId: (userId) => Effect.succeed(servicesOffered.filter((service) => service.userId === userId && service.deletedAt === null)),
        create: () => Effect.succeed(makeServiceOffered()),
        updateByIdForUser: () => Effect.succeed(makeServiceOffered()),
        softDeleteByIdForUser: () => Effect.succeed(makeServiceOffered({ deletedAt: new Date() })),
      }),
    ),
  );

  return createApp(runtime);
};

describe("/me/profile", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const app = makeApp({ authSession: null });
    const res = await app.request("/api/v1/me/profile");
    expect(res.status).toBe(401);
  });

  it("returns 403 when profile read permission is denied", async () => {
    const app = makeApp({ hasPermission: false });
    const res = await app.request("/api/v1/me/profile");
    expect(res.status).toBe(403);
  });

  it("returns service-provider onboarding state", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/me/profile");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.role).toBe("service-provider");
    expect(body.approval).toEqual({ id: "approval-1", approvalRequestId: "request-1", expiresAt: "2027-01-01T00:00:00.000Z" });
    expect(body.latestApprovalRequest).toMatchObject({ id: "request-1", status: "submitted" });
    expect(body.kycDocuments).toEqual([
      expect.objectContaining({ id: "kyc-document-1", documentTypeId: "document-type-1", status: "submitted" }),
    ]);
    expect(body.optionalDocumentTypes).toEqual([{ id: "optional-doc", name: "Driving License" }]);
    expect(body.servicesOffered).toEqual([
      expect.objectContaining({ id: "service-1", name: "After school babysitting", hourlyRateCents: 2800 }),
    ]);
    expect(body.warnings.missingServicesOffered).toBe(false);
  });

  it("returns missing document and service warnings", async () => {
    const app = makeApp({ kycDocuments: [], servicesOffered: [] });
    const res = await app.request("/api/v1/me/profile");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.missingRequiredDocuments).toEqual([{ documentTypeId: "document-type-1", name: "Government ID" }]);
    expect(body.warnings.missingServicesOffered).toBe(true);
  });

  it("omits service-provider onboarding state for family users", async () => {
    const app = makeApp({ profile: makeProfile({ role: "family" }), user: makeUser({ role: "family" }) });
    const res = await app.request("/api/v1/me/profile");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.role).toBe("family");
    expect(body).not.toHaveProperty("kycDocuments");
    expect(body).not.toHaveProperty("servicesOffered");
  });

  it("ignores email in profile PATCH but applies supported fields", async () => {
    const updates: Array<UserProfileUpdate> = [];
    const app = makeApp({ onUpdate: (input) => updates.push(input) });

    const res = await app.request("/api/v1/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", firstName: "Updated" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.email).toBe("provider@example.com");
    expect(body.firstName).toBe("Updated");
    expect(updates).toEqual([{ firstName: "Updated" }]);
  });

  it("updates location from a Google place id", async () => {
    const updates: Array<UserProfileLocationUpdate> = [];
    const app = makeApp({ onLocationUpdate: (input) => updates.push(input) });

    const res = await app.request("/api/v1/me/profile/location", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ googlePlaceId: "place-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ googlePlaceId: "place-1" });
    expect(body).not.toHaveProperty("latitude");
    expect(body).not.toHaveProperty("longitude");
    expect(updates).toEqual([expect.objectContaining({ googlePlaceId: "place-1", latitude: 43.6532, longitude: -79.3832 })]);
  });
});
