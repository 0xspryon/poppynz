import {
  makeApprovalRepoTest,
  makeKycDocumentRepoTest,
  makeSignupIntentRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  makeUserProfileRepoTest,
  type Approval,
  type ApprovalDecisionInput,
  type KycDocument,
  type SafeUserProfile,
  type Session,
  type SignupIntent,
  type User,
  type UserProfile,
  type UserProfileUpdate,
  DBNotFoundError,
} from "@repo/db";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { makeAuthServiceTest, type AuthSession, type Permissions } from "../../../lib/effect-auth";
import { createApp } from "../../../index";
import { makeSignupServiceTest, type SignupRole } from "../auth/signup/signup.handler";

const makeSignupIntent = (): SignupIntent => ({
  id: "signup-intent-1",
  email: "user@example.com",
  role: "family",
  language: "en",
  expiresAt: new Date(),
  consumedAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
});

const makeProfile = (overrides: Partial<SafeUserProfile> = {}): SafeUserProfile => ({
  userId: "user-1",
  email: "mom_helper@poppynz.com",
  role: "family",
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
  ...overrides,
});

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  name: "Mom Helper",
  email: "mom_helper@poppynz.com",
  emailVerified: true,
  image: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  isAnonymous: false,
  role: "family",
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null,
  ...overrides,
});

const makeApproval = (overrides: Partial<Approval> = {}): Approval => ({
  id: "approval-1",
  userId: "user-1",
  type: "family",
  status: "approved",
  approvedBy: null,
  reason: "Automatically approved",
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const makeKycDocument = (overrides: Partial<KycDocument> = {}): KycDocument => ({
  id: "kyc-document-1",
  userId: "user-1",
  type: "government-id",
  filename: "government-id.pdf",
  fileKey: "private/government-id.pdf",
  status: "uploaded",
  reason: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
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

const makeApp = (options: {
  authSession: AuthSession | null;
  hasPermission?: boolean;
  user?: User | null;
  session?: Session | null;
  profile: SafeUserProfile;
  approval?: Approval | null;
  kycDocuments?: Array<KycDocument>;
  onUpdate?: (input: UserProfileUpdate) => void;
  onPermissionCheck?: (permissions: Permissions) => void;
}) => {
  let profile = options.profile;
  const user = options.user === undefined ? makeUser({ id: profile.userId, email: profile.email, role: profile.role }) : options.user;
  const session = options.session === undefined ? makeSession({ userId: profile.userId }) : options.session;
  const approval = options.approval === undefined
    ? profile.role === "family"
      ? makeApproval({ userId: profile.userId, type: "family" })
      : null
    : options.approval;
  const kycDocuments = options.kycDocuments ?? [];
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      makeSignupIntentRepoTest({
        create: () => Effect.succeed(makeSignupIntent()),
        findValidByEmail: () => Effect.succeed(null),
        consumeByEmail: () => Effect.succeed(makeSignupIntent()),
      }),
      makeSignupServiceTest({
        sendSignupLink: (_: { email: string; role: SignupRole; headers: Headers }) => Effect.void,
      }),
      makeAuthServiceTest({
        getSession: () => Effect.succeed(options.authSession),
        userHasPermission: (_headers: Headers, permissions: Permissions) => {
          options.onPermissionCheck?.(permissions);

          return Effect.succeed(options.hasPermission ?? true);
        },
      }),
      makeUserRepoTest({
        findById: (id: string) => {
          if (user?.id === id) { return Effect.succeed(user) }
          return Effect.fail(new DBNotFoundError({ entity: 'user', value: user?.id ?? '' }))
        },
        findByEmail: (email: string) => {
          if (user?.email === email.toLowerCase()) { return Effect.succeed(user) }
          return Effect.fail(new DBNotFoundError({ value: email, entity: 'user' }))
        },
      }),
      makeSessionRepoTest({
        findById: (id: string) => {
          if (session?.id === id) { return Effect.succeed(session) }
          return Effect.fail(new DBNotFoundError({ value: id, entity: 'session' }))
        },
      }),
      makeUserProfileRepoTest({
        create: (input: { userId: string; language: string }) =>
          Effect.succeed({ ...makeProfile(), userId: input.userId, language: input.language } as UserProfile),
        findByUserId: (userId: string) => {
          if (profile.userId === userId) { return Effect.succeed(profile) }
          return Effect.fail(new DBNotFoundError({ value: userId, entity: 'user' }))
        },
        updateByUserId: (userId: string, input: UserProfileUpdate) => {
          options.onUpdate?.(input);
          profile = { ...profile, ...input };
          if (profile.userId === userId) {
            return Effect.succeed(profile);
          }
          return Effect.fail(new DBNotFoundError({ value: userId, entity: 'user' }))
        },
      }),
      makeApprovalRepoTest({
        findByUserIdAndType: (userId: string, type: Approval["type"]) => {
          if (approval?.userId === userId && approval.type === type) {
            return Effect.succeed(approval)
          }
          return Effect.fail(new DBNotFoundError({ value: userId, entity: 'user' }))
        },
        upsertDecision: (input: ApprovalDecisionInput) =>
          Effect.succeed(makeApproval({
            userId: input.userId,
            type: input.type,
            status: input.status,
            approvedBy: input.approvedBy,
            reason: input.reason ?? null,
          })),
      }),
      makeKycDocumentRepoTest({
        findByUserId: (userId: string) =>
          Effect.succeed(kycDocuments.filter((document) => document.userId === userId)),
        approveSubmittedByUserId: () => Effect.succeed([]),
      }),
    ),
  );

  return createApp(runtime);
};

describe("/me/profile", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const app = makeApp({ authSession: null, profile: makeProfile() });

    const res = await app.request("/app/api/v1/me/profile");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication is required.",
      },
    });
  });

  it("returns 403 when profile read permission is denied", async () => {
    const app = makeApp({
      authSession: { user: { id: "user-1" }, session: { id: "session-1" } },
      hasPermission: false,
      profile: makeProfile(),
    });

    const res = await app.request("/app/api/v1/me/profile");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to access this resource.",
      },
    });
  });

  it("returns only safe profile fields for family users", async () => {
    const permissionChecks: Array<Permissions> = [];
    const app = makeApp({
      authSession: { user: { id: "user-1" }, session: { id: "session-1" } },
      profile: makeProfile(),
      onPermissionCheck: (permissions) => permissionChecks.push(permissions),
    });

    const res = await app.request("/app/api/v1/me/profile");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      userId: "user-1",
      email: "mom_helper@poppynz.com",
      role: "family",
      approval: {
        type: "family",
        status: "approved",
        reason: "Automatically approved",
      },
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
    });
    expect(body).not.toHaveProperty("password");
    expect(body).not.toHaveProperty("newPassword");
    expect(body).not.toHaveProperty("username");
    expect(body).not.toHaveProperty("hourlyRate");
    expect(permissionChecks).toEqual([{ profile: ["read"] }]);
  });

  it("returns profile fields for service-provider users", async () => {
    const app = makeApp({
      authSession: { user: { id: "user-1" }, session: { id: "session-1" } },
      user: makeUser({ role: "service-provider" }),
      profile: makeProfile({ role: "service-provider" }),
      kycDocuments: [
        makeKycDocument({
          type: "government-id",
          filename: "government-id.pdf",
          status: "uploaded",
        }),
      ],
    });

    const res = await app.request("/app/api/v1/me/profile");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.role).toBe("service-provider");
    expect(body.approval).toEqual({
      type: "service-provider",
      status: "pending",
      reason: null,
    });
    expect(body.kycDocuments).toEqual([
      {
        id: "kyc-document-1",
        type: "government-id",
        filename: "government-id.pdf",
        status: "uploaded",
        reason: null,
      },
    ]);
    expect(body.kycDocuments[0]).not.toHaveProperty("fileKey");
  });

  it("returns rejected approval state and reason", async () => {
    const app = makeApp({
      authSession: { user: { id: "user-1" }, session: { id: "session-1" } },
      user: makeUser({ role: "service-provider" }),
      profile: makeProfile({ role: "service-provider" }),
      approval: makeApproval({
        type: "service-provider",
        status: "rejected",
        reason: "Documents are incomplete.",
      }),
    });

    const res = await app.request("/app/api/v1/me/profile");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.approval).toEqual({
      type: "service-provider",
      status: "rejected",
      reason: "Documents are incomplete.",
    });
  });

  it("ignores email in profile PATCH but applies supported fields", async () => {
    const updates: Array<UserProfileUpdate> = [];
    const app = makeApp({
      authSession: { user: { id: "user-1" }, session: { id: "session-1" } },
      profile: makeProfile(),
      onUpdate: (input) => updates.push(input),
    });

    const res = await app.request("/app/api/v1/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", firstName: "Updated" }),
    });

    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.email).toBe("mom_helper@poppynz.com");
    expect(body.firstName).toBe("Updated");
    expect(updates).toEqual([{ firstName: "Updated" }]);
  });

  it("rejects unsupported gender values", async () => {
    const updates: Array<UserProfileUpdate> = [];
    const app = makeApp({
      authSession: { user: { id: "user-1" }, session: { id: "session-1" } },
      profile: makeProfile(),
      onUpdate: (input) => updates.push(input),
    });

    const res = await app.request("/app/api/v1/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gender: "other" }),
    });

    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: "INVALID_PROFILE_INPUT",
        message: "Profile update contains invalid or unsupported fields.",
      },
    });
    expect(body.error.issues).toContainEqual(
      expect.objectContaining({ path: ["gender"] }),
    );
    expect(updates).toEqual([]);
  });
});
