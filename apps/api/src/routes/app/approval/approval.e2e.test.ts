import {
  EmptyKycDocumentRepoTest,
  EmptyKycDocumentTypeRepoTest,
  EmptySignupIntentRepoTest,
  DBNotFoundError,
  makeApprovalRepoTest,
  makeApprovalRequestRepoTest,
  makeServiceOfferedRepoTest,
  makeSessionRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  type Approval,
  type ApprovalCreateInput,
  type ApprovalRequest,
  type Session,
  type User,
} from "@repo/db";
import { makeGooglePlacesTest } from "@repo/google";
import { Effect, Layer, ManagedRuntime } from "effect";
import { makeObjectStorageTest } from "@repo/objs";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../index";
import { makeAuthServiceTest, type AuthSession, type Permissions } from "../../../lib/effect-auth";
import { EmptySigninServiceTest } from "../auth/signin/signin.handler";
import { EmptySignupServiceTest } from "../auth/signup/signup.handler";

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

const makeApprovalRequest = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: "request-1",
  userId: "provider-1",
  status: "submitted",
  reviewedBy: null,
  reviewedAt: null,
  reason: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const makeApproval = (input: ApprovalCreateInput, overrides: Partial<Approval> = {}): Approval => ({
  id: "approval-1",
  userId: input.userId,
  approvalRequestId: input.approvalRequestId,
  approvedBy: input.approvedBy,
  status: "approved",
  reason: null,
  expiresAt: input.expiresAt,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...overrides,
});

const makeInMemoryApprovalRequestRepo = (requests: Array<ApprovalRequest>) => ({
  createSubmitted: (userId: string) => {
    const request = makeApprovalRequest({ id: `request-${requests.length + 1}`, userId });
    requests.push(request);
    return Effect.succeed(request);
  },
  list: () => Effect.succeed(requests),
  findById: (id: string) => {
    const request = requests.find((request) => request.id === id);
    return request ? Effect.succeed(request) : Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id }));
  },
  findSubmittedByUserId: (userId: string) => {
    const request = requests.find((request) => request.userId === userId && request.status === "submitted");
    return request ? Effect.succeed(request) : Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: userId }));
  },
  findLatestByUserId: (userId: string) => {
    const request = requests.find((request) => request.userId === userId);
    return request ? Effect.succeed(request) : Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: userId }));
  },
  markApproved: (id: string, reviewedBy: string) => {
    const request = requests.find((request) => request.id === id);
    if (!request) return Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id }));
    request.status = "approved";
    request.reviewedBy = reviewedBy;
    request.reviewedAt = new Date("2026-06-12T00:00:00.000Z");
    return Effect.succeed(request);
  },
  reject: (id: string, reviewedBy: string, reason: string) => {
    const request = requests.find((request) => request.id === id);
    if (!request) return Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id }));
    request.status = "rejected";
    request.reviewedBy = reviewedBy;
    request.reviewedAt = new Date("2026-06-12T00:00:00.000Z");
    request.reason = reason;
    return Effect.succeed(request);
  },
});

const makeInMemoryApprovalRepo = (approvals: Array<Approval>) => ({
  create: (input: ApprovalCreateInput) => {
    const approval = makeApproval(input, { id: `approval-${approvals.length + 1}` });
    approvals.push(approval);
    return Effect.succeed(approval);
  },
  findCurrentByUserId: (userId: string) => {
    const approval = approvals.find((approval) => approval.userId === userId);
    return approval ? Effect.succeed(approval) : Effect.fail(new DBNotFoundError({ entity: "approval", value: userId }));
  },
});

const makeApp = (options: {
  authSession?: AuthSession | null;
  hasPermission?: boolean;
  requests?: Array<ApprovalRequest>;
  approvals?: Array<Approval>;
  onPermissionCheck?: (permissions: Permissions) => void;
} = {}) => {
  const admin = makeUser({ id: "admin-1", email: "admin@example.com", role: "admin" });
  const provider = makeUser();
  const requests = options.requests ?? [makeApprovalRequest()];
  const approvals = options.approvals ?? [];
  const authSession = options.authSession === undefined ? { user: { id: "admin-1" }, session: { id: "session-1" } } : options.authSession;
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      EmptySignupIntentRepoTest,
      EmptySigninServiceTest,
      EmptySignupServiceTest,
      EmptyKycDocumentRepoTest,
      EmptyKycDocumentTypeRepoTest,
      makeUserProfileRepoTest({
        create: (input) => Effect.succeed({ userId: input.userId, language: input.language } as never),
        findByUserId: (userId) => Effect.succeed({
          userId,
          email: "provider@example.com",
          role: "service-provider",
          language: "en",
          firstName: "Provider",
          lastName: "User",
          gender: null,
          phoneNumber: null,
          dateOfBirth: null,
          address: "123 Main Street",
          city: "Toronto",
          postalCode: "M5H 1A1",
          country: "CA",
          stateProvince: "ON",
          shortBio: null,
          googlePlaceId: "place-1",
          latitude: 43.6532,
          longitude: -79.3832,
        }),
        updateByUserId: (userId) => Effect.fail(new DBNotFoundError({ entity: "userProfile", value: userId })),
        updateLocationByUserId: (userId) => Effect.fail(new DBNotFoundError({ entity: "userProfile", value: userId })),
      }),
      makeServiceOfferedRepoTest({
        listByUserId: (userId) => Effect.succeed([{
          id: "service-1",
          userId,
          name: "Childcare",
          description: null,
          hourlyRateCents: 2500,
          currency: "CAD",
          deletedAt: null,
          createdAt: new Date("2026-06-12T00:00:00.000Z"),
          updatedAt: new Date("2026-06-12T00:00:00.000Z"),
        }]),
        create: () => Effect.die("not used"),
        updateByIdForUser: () => Effect.die("not used"),
        softDeleteByIdForUser: () => Effect.die("not used"),
      }),
      makeGooglePlacesTest({ lookupPlaceById: () => Effect.die("not used") }),
      makeObjectStorageTest({
        ensureBucketExists: () => Effect.void,
        ensurePublicReadBucket: () => Effect.void,
        createPresignedPutUrl: () => Effect.succeed({ uploadUrl: "https://example.com", expiresAt: new Date() }),
      }),
      makeApprovalRepoTest(makeInMemoryApprovalRepo(approvals)),
      makeApprovalRequestRepoTest(makeInMemoryApprovalRequestRepo(requests)),
      makeAuthServiceTest({
        getSession: () => Effect.succeed(authSession),
        userHasPermission: (_headers, permissions) => {
          options.onPermissionCheck?.(permissions);
          return Effect.succeed(options.hasPermission ?? true);
        },
      }),
      makeUserRepoTest({
        findById: (id) => {
          const user = [admin, provider].find((user) => user.id === id);
          return user ? Effect.succeed(user) : Effect.fail(new DBNotFoundError({ entity: "user", value: id }));
        },
        findByEmail: () => Effect.succeed(provider),
      }),
      makeSessionRepoTest({
        findById: (id) => id === "session-1" ? Effect.succeed(makeSession()) : Effect.fail(new DBNotFoundError({ entity: "session", value: id })),
      }),
    ),
  );

  return createApp(runtime);
};

describe("POST /approvals", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const app = makeApp({ authSession: null });

    const res = await app.request("/app/api/v1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", approvalRequestId: "request-1", expiresAt: "2027-01-01" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 403 when approval permission is denied", async () => {
    const permissionChecks: Array<Permissions> = [];
    const app = makeApp({ hasPermission: false, onPermissionCheck: (permissions) => permissionChecks.push(permissions) });

    const res = await app.request("/app/api/v1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", approvalRequestId: "request-1", expiresAt: "2027-01-01" }),
    });

    expect(res.status).toBe(403);
    expect(permissionChecks).toEqual([{ approval: ["write"] }]);
  });

  it("rejects missing expiry dates", async () => {
    const app = makeApp();

    const res = await app.request("/app/api/v1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", approvalRequestId: "request-1" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_APPROVAL_INPUT");
  });

  it("rejects past expiry dates", async () => {
    const app = makeApp();

    const res = await app.request("/app/api/v1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", approvalRequestId: "request-1", expiresAt: "2020-01-01" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_APPROVAL_INPUT");
  });

  it("returns 404 when approval request is missing", async () => {
    const app = makeApp({ requests: [] });

    const res = await app.request("/app/api/v1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", approvalRequestId: "missing-request", expiresAt: "2027-01-01" }),
    });

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("APPROVAL_REQUEST_NOT_FOUND");
  });

  it("creates approval and marks approval request approved", async () => {
    const approvals: Array<Approval> = [];
    const requests = [makeApprovalRequest()];
    const app = makeApp({ approvals, requests });

    const res = await app.request("/app/api/v1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", approvalRequestId: "request-1", expiresAt: "2027-01-01" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ userId: "provider-1", approvalRequestId: "request-1", approvedBy: "admin-1" });
    expect(approvals).toHaveLength(1);
    expect(requests[0]?.status).toBe("approved");
  });

  it("rejects mismatched user and approval request", async () => {
    const app = makeApp({ requests: [makeApprovalRequest({ userId: "other-user" })] });

    const res = await app.request("/app/api/v1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "provider-1", approvalRequestId: "request-1", expiresAt: "2027-01-01" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("APPROVAL_REQUEST_MISMATCH");
  });
});
