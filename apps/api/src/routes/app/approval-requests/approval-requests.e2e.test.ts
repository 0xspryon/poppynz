import {
  DBNotFoundError,
  EmptyApprovalRepoTest,
  EmptyKycDocumentRepoTest,
  EmptyKycDocumentTypeRepoTest,
  EmptyServiceOfferedRepoTest,
  EmptySignupIntentRepoTest,
  EmptyUserProfileRepoTest,
  makeApprovalRequestRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type ApprovalRequest,
  type Session,
  type User,
} from "@repo/db";
import { makeGooglePlacesTest } from "@repo/google";
import { Effect, Layer, ManagedRuntime } from "effect";
import { makeObjectStorageTest } from "@repo/objs";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../index";
import { makeAuthServiceTest, type AuthSession } from "../../../lib/effect-auth";
import { makeMailerTest } from "../../../lib/mailer";
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
  userId: "provider-1",
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

const makeApprovalRequestRepo = (requests: Array<ApprovalRequest>) => ({
  createSubmitted: (userId: string) => {
    const request = makeApprovalRequest({ id: `request-${requests.length + 1}`, userId, status: "submitted" });
    requests.push(request);
    return Effect.succeed(request);
  },
  list: () => Effect.succeed(requests),
  listWithApplicant: () => Effect.succeed(requests.map((request) => ({ ...request, applicant: { email: "provider@example.com", firstName: "Maria", lastName: "Santos" } }))),
  countByStatus: () => Effect.succeed({
    submitted: requests.filter((request) => request.status === "submitted").length,
    approved: requests.filter((request) => request.status === "approved").length,
    rejected: requests.filter((request) => request.status === "rejected").length,
  }),
  listByUserId: (userId: string) => Effect.succeed(requests.filter((request) => request.userId === userId)),
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
    return Effect.succeed(request);
  },
  reject: (id: string, reviewedBy: string, reason: string) => {
    const request = requests.find((request) => request.id === id);
    if (!request) return Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id }));
    request.status = "rejected";
    request.reviewedBy = reviewedBy;
    request.reason = reason;
    return Effect.succeed(request);
  },
});

const makeApp = (options: { authSession?: AuthSession | null; user?: User; requests?: Array<ApprovalRequest> } = {}) => {
  const user = options.user ?? makeUser();
  const requests = options.requests ?? [];
  const authSession = options.authSession === undefined ? { user: { id: user.id }, session: { id: "session-1" } } : options.authSession;
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      EmptySignupIntentRepoTest,
      EmptySigninServiceTest,
      EmptySignupServiceTest,
      EmptyUserProfileRepoTest,
      makeMailerTest({}),
      EmptyApprovalRepoTest,
      EmptyKycDocumentRepoTest,
      EmptyKycDocumentTypeRepoTest,
      EmptyServiceOfferedRepoTest,
      makeGooglePlacesTest({ lookupPlaceById: () => Effect.die("not used"), autocompletePlaces: () => Effect.succeed([]) }),
      makeObjectStorageTest({
        ensureBucketExists: () => Effect.void,
        ensurePublicReadBucket: () => Effect.void,
        createPresignedPutUrl: () => Effect.succeed({ uploadUrl: "https://example.com", expiresAt: new Date() }),
        createPresignedGetUrl: () => Effect.succeed({ url: "https://example.com", expiresAt: new Date() }),
      }),
      makeApprovalRequestRepoTest(makeApprovalRequestRepo(requests)),
      makeAuthServiceTest({
        getSession: () => Effect.succeed(authSession),
        userHasPermission: () => Effect.succeed(true),
      }),
      makeUserRepoTest({
        findById: (id) => id === user.id ? Effect.succeed(user) : Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
        findByEmail: () => Effect.succeed(user),
      }),
      makeSessionRepoTest({
        findById: (id) => id === "session-1" ? Effect.succeed(makeSession({ userId: user.id })) : Effect.fail(new DBNotFoundError({ entity: "session", value: id })),
      }),
    ),
  );

  return createApp(runtime);
};

describe("POST /approval-requests", () => {
  it("creates a submitted approval request", async () => {
    const requests: Array<ApprovalRequest> = [];
    const app = makeApp({ requests });

    const res = await app.request("/api/v1/approval-requests", { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: "request-1", status: "submitted" });
    expect(requests).toHaveLength(1);
  });

  it("prevents duplicate submitted approval requests", async () => {
    const app = makeApp({ requests: [makeApprovalRequest()] });

    const res = await app.request("/api/v1/approval-requests", { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("APPROVAL_REQUEST_ALREADY_SUBMITTED");
  });

  it("allows a new request when the previous request was rejected", async () => {
    const requests = [makeApprovalRequest({ status: "rejected", reason: "Incomplete." })];
    const app = makeApp({ requests });

    const res = await app.request("/api/v1/approval-requests", { method: "POST" });

    expect(res.status).toBe(200);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.status).toBe("submitted");
  });
});
