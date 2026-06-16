import {
  EmptyApprovalRepoTest,
  EmptyKycDocumentRepoTest,
  EmptyUserProfileRepoTest,
  EmptySignupIntentRepoTest,
  DBNotFoundError,
  makeSessionRepoTest,
  makeUserRepoTest,
  type ApprovalDecisionInput,
  type Session,
  type SignupIntent,
  type User,
} from "@repo/db";
import { makeObjectStorageTest, type PresignedPutInput } from "@repo/objs";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../index";
import { makeAuthServiceTest, type AuthSession } from "../../../lib/effect-auth";
import { EmptySigninServiceTest } from "../auth/signin/signin.handler";
import { EmptySignupServiceTest, type SignupRole } from "../auth/signup/signup.handler";

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  name: "Test User",
  email: "user@example.com",
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

const makeApp = (options: {
  authSession?: AuthSession | null;
  user?: User;
  onPresign?: (input: PresignedPutInput) => void;
} = {}) => {
  const user = options.user ?? makeUser();
  const authSession = options.authSession === undefined
    ? { user: { id: user.id }, session: { id: "session-1" } }
    : options.authSession;
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      makeAuthServiceTest({
        getSession: () => Effect.succeed(authSession),
        userHasPermission: () => Effect.succeed(true),
      }),
      EmptySignupIntentRepoTest,
      EmptySigninServiceTest,
      EmptySignupServiceTest,
      makeUserRepoTest({
        findById: (id: string) =>
          id === user.id
            ? Effect.succeed(user)
            : Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
        findByEmail: () => Effect.fail(new DBNotFoundError({ entity: "user", value: "email" })),
      }),
      makeSessionRepoTest({
        findById: (id: string) =>
          id === "session-1"
            ? Effect.succeed(makeSession({ userId: user.id }))
            : Effect.fail(new DBNotFoundError({ entity: "session", value: id })),
      }),
      EmptyUserProfileRepoTest,
      EmptyApprovalRepoTest,
      EmptyKycDocumentRepoTest,
      makeObjectStorageTest({
        ensureBucketExists: () => Effect.void,
        ensurePublicReadBucket: () => Effect.void,
        createPresignedPutUrl: (input) => {
          options.onPresign?.(input);

          return Effect.succeed({
            uploadUrl: `https://uploads.example.com/${input.bucket}/${input.key}`,
            expiresAt: new Date("2026-06-12T00:10:00.000Z"),
          });
        },
      }),
    ),
  );

  return createApp(runtime);
};

describe("/uploads/presigned-url", () => {
  beforeEach(() => {
    process.env.OBJS_KYC_BUCKET = "kyc-documents";
    process.env.OBJS_PUBLIC_BUCKET = "public-assets";
    vi.spyOn(crypto, "randomUUID").mockReturnValue("up-lo-ad-id-dummy");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a presigned URL for service-provider KYC uploads", async () => {
    let presignInput: PresignedPutInput | null = null;
    const app = makeApp({ onPresign: (input) => { presignInput = input; } });

    const res = await app.request("/app/api/v1/uploads/presigned-url", {
      method: "POST",
      body: JSON.stringify({
        target: "kyc-document",
        documentType: "government-id",
        fileName: "Government ID.pdf",
        contentType: "application/pdf",
        sizeBytes: 1234,
      }),
      headers: { "content-type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bucket).toBe("kyc-documents");
    expect(body.fileKey).toBe("users/user-1/kyc/government-id/up-lo-ad-id-dummy-Government-ID.pdf");
    expect(body.uploadUrl).toContain("https://uploads.example.com/kyc-documents/");
    expect(body.expiresAt).toBe("2026-06-12T00:10:00.000Z");
    expect(presignInput).toEqual({
      bucket: "kyc-documents",
      key: "users/user-1/kyc/government-id/up-lo-ad-id-dummy-Government-ID.pdf",
      contentType: "application/pdf",
      expiresInSeconds: 600,
    });
  });

  it("returns a presigned URL for public profile pictures", async () => {
    const app = makeApp({ user: makeUser({ role: "family" }) });

    const res = await app.request("/app/api/v1/uploads/presigned-url", {
      method: "POST",
      body: JSON.stringify({
        target: "public-profile-picture",
        fileName: "avatar.png",
        contentType: "image/png",
        sizeBytes: 1234,
      }),
      headers: { "content-type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bucket).toBe("public-assets");
    expect(body.fileKey).toBe("users/user-1/public/profile-pictures/up-lo-ad-id-dummy-avatar.png");
  });

  it("rejects KYC uploads from non-service-provider users", async () => {
    const app = makeApp({ user: makeUser({ role: "family" }) });

    const res = await app.request("/app/api/v1/uploads/presigned-url", {
      method: "POST",
      body: JSON.stringify({
        target: "kyc-document",
        documentType: "government-id",
        fileName: "id.pdf",
        contentType: "application/pdf",
        sizeBytes: 1234,
      }),
      headers: { "content-type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_UPLOAD");
  });

  it("returns 401 when unauthenticated", async () => {
    const app = makeApp({ authSession: null });

    const res = await app.request("/app/api/v1/uploads/presigned-url", {
      method: "POST",
      body: JSON.stringify({
        target: "public-profile-picture",
        fileName: "avatar.png",
        contentType: "image/png",
        sizeBytes: 1234,
      }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(401);
  });
});
