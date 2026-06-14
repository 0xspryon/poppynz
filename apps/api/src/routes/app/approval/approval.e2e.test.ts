import {
  makeApprovalRepoTest,
  makeKycDocumentRepoTest,
  makeSessionRepoTest,
  makeSignupIntentRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  DBNotFoundError,
  type Approval,
  type ApprovalDecisionInput,
  type KycDocument,
  type Session,
  type SignupIntent,
  type User,
  type UserProfile,
} from "@repo/db";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../index";
import { makeAuthServiceTest, type AuthSession, type Permissions } from "../../../lib/effect-auth";
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

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "provider-1",
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
  userId: "admin-1",
  impersonatedBy: null,
  activeOrganizationId: null,
  ...overrides,
});

const makeProfile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  userId: "provider-1",
  language: "en",
  firstName: null,
  lastName: null,
  gender: null,
  phoneNumber: null,
  dateOfBirth: null,
  address: null,
  city: null,
  postalCode: null,
  country: null,
  stateProvince: null,
  shortBio: null,
  ...overrides,
});

const makeApproval = (input: ApprovalDecisionInput, overrides: Partial<Approval> = {}): Approval => ({
  id: `approval-${input.userId}-${input.type}`,
  userId: input.userId,
  type: input.type,
  status: input.status,
  approvedBy: input.approvedBy,
  reason: input.reason ?? null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const makeKycDocument = (overrides: Partial<KycDocument> = {}): KycDocument => ({
  id: "kyc-document-1",
  userId: "provider-1",
  type: "government-id",
  filename: "government-id.pdf",
  fileKey: "private/government-id.pdf",
  status: "uploaded",
  reason: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const makeInMemoryApprovalRepo = (approvals: Array<Approval>) => ({
  findByUserIdAndType: (userId: string, type: Approval["type"]) => {
    const approval = approvals.find((approval) => approval.userId === userId && approval.type === type);

    return approval
      ? Effect.succeed(approval)
      : Effect.fail(new DBNotFoundError({ entity: "approval", value: userId }));
  },
  upsertDecision: (input: ApprovalDecisionInput) => {
    const existingIndex = approvals.findIndex(
      (approval) => approval.userId === input.userId && approval.type === input.type,
    );
    const approval = makeApproval(input);

    if (existingIndex >= 0) {
      approvals[existingIndex] = {
        ...approvals[existingIndex],
        status: input.status,
        approvedBy: input.approvedBy,
        reason: input.reason ?? null,
        updatedAt: approval.updatedAt,
      };

      return Effect.succeed(approvals[existingIndex]);
    }

    approvals.push(approval);
    return Effect.succeed(approval);
  },
});

const makeInMemoryKycDocumentRepo = (documents: Array<KycDocument>) => ({
  findByUserId: (userId: string) => Effect.succeed(documents.filter((document) => document.userId === userId)),
  approveSubmittedByUserId: (userId: string) => {
    const updated: Array<KycDocument> = [];

    for (const document of documents) {
      if (document.userId === userId && (document.status === "uploaded" || document.status === "rejected")) {
        document.status = "approved";
        document.reason = null;
        document.updatedAt = new Date("2026-06-12T00:00:00.000Z");
        updated.push(document);
      }
    }

    return Effect.succeed(updated);
  },
});

const makeApp = (options: {
  authSession?: AuthSession | null;
  hasPermission?: boolean;
  users?: Array<User>;
  approvals?: Array<Approval>;
  documents?: Array<KycDocument>;
  onPermissionCheck?: (permissions: Permissions) => void;
} = {}) => {
  const admin = makeUser({ id: "admin-1", email: "admin@example.com", role: "admin" });
  const provider = makeUser();
  const users = options.users ?? [admin, provider];
  const approvals = options.approvals ?? [];
  const documents = options.documents ?? [];
  const authSession = options.authSession === undefined
    ? { user: { id: "admin-1" }, session: { id: "session-1" } }
    : options.authSession;
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
        getSession: () => Effect.succeed(authSession),
        userHasPermission: (_headers: Headers, permissions: Permissions) => {
          options.onPermissionCheck?.(permissions);

          return Effect.succeed(options.hasPermission ?? true);
        },
      }),
      makeUserRepoTest({
        findById: (id: string) => {
          const user = users.find((user) => user.id === id);

          return user
            ? Effect.succeed(user)
            : Effect.fail(new DBNotFoundError({ entity: "user", value: id }));
        },
        findByEmail: (email: string) => {
          const user = users.find((user) => user.email === email.toLowerCase());

          return user
            ? Effect.succeed(user)
            : Effect.fail(new DBNotFoundError({ entity: "user", value: email.toLowerCase() }));
        },
      }),
      makeSessionRepoTest({
        findById: (id: string) =>
          id === "session-1"
            ? Effect.succeed(makeSession())
            : Effect.fail(new DBNotFoundError({ entity: "session", value: id })),
      }),
      makeUserProfileRepoTest({
        create: (input: { userId: string; language: string }) => Effect.succeed(makeProfile(input)),
        findByUserId: (userId: string) => Effect.fail(new DBNotFoundError({ entity: "userProfile", value: userId })),
        updateByUserId: (userId: string) => Effect.fail(new DBNotFoundError({ entity: "userProfile", value: userId })),
      }),
      makeApprovalRepoTest(makeInMemoryApprovalRepo(approvals)),
      makeKycDocumentRepoTest(makeInMemoryKycDocumentRepo(documents)),
    ),
  );

  return createApp(runtime);
};

describe("POST /approval", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const app = makeApp({ authSession: null });

    const res = await app.request("/app/api/v1/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", type: "service-provider", status: "approved" }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication is required.",
      },
    });
  });

  it("returns 403 when approval permission is denied", async () => {
    const permissionChecks: Array<Permissions> = [];
    const app = makeApp({
      hasPermission: false,
      onPermissionCheck: (permissions) => permissionChecks.push(permissions),
    });

    const res = await app.request("/app/api/v1/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", type: "service-provider", status: "approved" }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to access this resource.",
      },
    });
    expect(permissionChecks).toEqual([{ approval: ["create"] }]);
  });

  it("returns 400 when rejection reason is missing", async () => {
    const app = makeApp();

    const res = await app.request("/app/api/v1/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", type: "service-provider", status: "rejected" }),
    });

    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: "INVALID_APPROVAL_INPUT",
        message: "Approval request contains invalid or unsupported fields.",
      },
    });
    expect(body.error.issues).toEqual([
      expect.objectContaining({
        path: ["reason"],
        message: "A rejection reason is required.",
      }),
    ]);
  });

  it("returns 404 when the target user does not exist", async () => {
    const app = makeApp({ users: [makeUser({ id: "admin-1", email: "admin@example.com", role: "admin" })] });

    const res = await app.request("/app/api/v1/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", type: "service-provider", status: "approved" }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        code: "APPROVAL_TARGET_NOT_FOUND",
        message: "The user to approve was not found.",
      },
    });
  });

  it("returns 400 when approval type does not match the user's role", async () => {
    const app = makeApp();

    const res = await app.request("/app/api/v1/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", type: "family", status: "approved" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "APPROVAL_TYPE_MISMATCH",
        message: "Approval type does not match the user's role.",
      },
    });
  });

  it("approves a service-provider with no documents", async () => {
    const approvals: Array<Approval> = [];
    const app = makeApp({ approvals });

    const res = await app.request("/app/api/v1/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", type: "service-provider", status: "approved" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      id: "approval-provider-1-service-provider",
      userId: "provider-1",
      type: "service-provider",
      status: "approved",
      approvedBy: "admin-1",
      reason: null,
    });
    expect(approvals).toEqual([
      expect.objectContaining({
        userId: "provider-1",
        type: "service-provider",
        status: "approved",
        approvedBy: "admin-1",
        reason: null,
      }),
    ]);
  });

  it("approves submitted documents when the account is approved", async () => {
    const documents = [
      makeKycDocument({ id: "uploaded-doc", status: "uploaded" }),
      makeKycDocument({ id: "rejected-doc", type: "first-aid-certification", status: "rejected", reason: "Expired." }),
      makeKycDocument({ id: "missing-doc", type: "driving-license", status: "missing" }),
      makeKycDocument({ id: "other-user-doc", userId: "other-user", status: "uploaded" }),
    ];
    const app = makeApp({ documents });

    const res = await app.request("/app/api/v1/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", type: "service-provider", status: "approved" }),
    });

    expect(res.status).toBe(200);
    expect(documents.find((document) => document.id === "uploaded-doc")?.status).toBe("approved");
    expect(documents.find((document) => document.id === "rejected-doc")?.status).toBe("approved");
    expect(documents.find((document) => document.id === "rejected-doc")?.reason).toBeNull();
    expect(documents.find((document) => document.id === "missing-doc")?.status).toBe("missing");
    expect(documents.find((document) => document.id === "other-user-doc")?.status).toBe("uploaded");
  });

  it("rejects an account without changing submitted document states", async () => {
    const documents = [
      makeKycDocument({ id: "uploaded-doc", status: "uploaded" }),
      makeKycDocument({ id: "approved-doc", type: "first-aid-certification", status: "approved" }),
      makeKycDocument({ id: "rejected-doc", type: "driving-license", status: "rejected", reason: "Blurry." }),
    ];
    const app = makeApp({ documents });

    const res = await app.request("/app/api/v1/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "provider-1",
        type: "service-provider",
        status: "rejected",
        reason: "Manual review failed.",
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("rejected");
    expect(body.reason).toBe("Manual review failed.");
    expect(documents.map((document) => ({ id: document.id, status: document.status, reason: document.reason }))).toEqual([
      { id: "uploaded-doc", status: "uploaded", reason: null },
      { id: "approved-doc", status: "approved", reason: null },
      { id: "rejected-doc", status: "rejected", reason: "Blurry." },
    ]);
  });
});
