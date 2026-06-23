import { DBNotFoundError, makeKycDocumentTypeRepoTest, type KycDocumentType } from "@repo/db";
import { makeObjectStorageTest, ObjectStorageError, type PresignedPutInput } from "@repo/objs";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAndSession } from "@/api/lib/effect-auth";
import { createUploadPresignProgram, UploadStorageError, UploadValidationError } from "./upload.handler";

const userAndSession = (role: UserAndSession["user"]["role"] = "service-provider"): UserAndSession => ({
  user: {
    id: "user-1",
    name: "Test User",
    email: "user@example.com",
    emailVerified: true,
    image: null,
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    updatedAt: new Date("2026-06-12T00:00:00.000Z"),
    isAnonymous: false,
    role,
    banned: false,
    banReason: null,
    banExpires: null,
    phoneNumber: null,
    phoneNumberVerified: null,
  },
  session: {
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
  },
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

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected effect to fail");
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error("Expected typed failure");
  return failure.value;
};

const makeLayer = (options: { documentType?: KycDocumentType | null; storageError?: ObjectStorageError; onPresign?: (input: PresignedPutInput) => void } = {}) =>
  Layer.mergeAll(
    makeKycDocumentTypeRepoTest({
      listActive: () => Effect.succeed([]),
      findActiveById: (id) => options.documentType === null
        ? Effect.fail(new DBNotFoundError({ entity: "kycDocumentType", value: id }))
        : Effect.succeed(options.documentType ?? documentType()),
      create: () => Effect.succeed(documentType()),
      update: () => Effect.succeed(documentType()),
      softDelete: () => Effect.succeed(documentType({ deletedAt: new Date() })),
    }),
    makeObjectStorageTest({
      ensureBucketExists: () => Effect.void,
      ensurePublicReadBucket: () => Effect.void,
      createPresignedPutUrl: (input) => {
        options.onPresign?.(input);
        return options.storageError
          ? Effect.fail(options.storageError)
          : Effect.succeed({ uploadUrl: `https://uploads.example.com/${input.bucket}/${input.key}`, expiresAt: new Date("2026-06-12T00:10:00.000Z") });
      },
    }),
  );

describe("createUploadPresignProgram", () => {
  beforeEach(() => {
    process.env.OBJS_KYC_BUCKET = "kyc-documents";
    process.env.OBJS_PUBLIC_BUCKET = "public-assets";
    vi.spyOn(crypto, "randomUUID").mockReturnValue("up-lo-ad-id-dummy");
  });

  afterEach(() => vi.restoreAllMocks());

  it("creates a presigned URL for KYC uploads", async () => {
    const presignInputs: Array<PresignedPutInput> = [];
    const result = await Effect.runPromise(
      createUploadPresignProgram(userAndSession(), {
        target: "kyc-document",
        documentTypeId: "document-type-1",
        fileName: "Government ID.pdf",
        contentType: "application/pdf",
        sizeBytes: 1234,
      }).pipe(Effect.provide(makeLayer({ onPresign: (input) => presignInputs.push(input) }))),
    );

    expect(result.bucket).toBe("kyc-documents");
    expect(result.fileKey).toBe("users/user-1/kyc/document-type-1/up-lo-ad-id-dummy-Government-ID.pdf");
    expect(presignInputs).toEqual([{ bucket: "kyc-documents", key: result.fileKey, contentType: "application/pdf", expiresInSeconds: 600 }]);
  });

  it("rejects KYC uploads from non-service-provider users", async () => {
    const exit = await Effect.runPromise(
      createUploadPresignProgram(userAndSession("family"), {
        target: "kyc-document",
        documentTypeId: "document-type-1",
        fileName: "id.pdf",
        contentType: "application/pdf",
        sizeBytes: 1234,
      }).pipe(Effect.provide(makeLayer()), Effect.exit),
    );

    expect(getFailure(exit)).toBeInstanceOf(UploadValidationError);
  });

  it("rejects unsupported public image content types", async () => {
    const exit = await Effect.runPromise(
      createUploadPresignProgram(userAndSession("family"), {
        target: "public-profile-picture",
        fileName: "avatar.gif",
        contentType: "image/gif",
        sizeBytes: 1234,
      }).pipe(Effect.provide(makeLayer()), Effect.exit),
    );

    expect(getFailure(exit)).toBeInstanceOf(UploadValidationError);
  });

  it("translates object storage failures", async () => {
    const storageError = new ObjectStorageError({ operation: "presignPutObject", bucket: "public-assets", cause: "down" });
    const exit = await Effect.runPromise(
      createUploadPresignProgram(userAndSession("family"), {
        target: "public-profile-picture",
        fileName: "avatar.png",
        contentType: "image/png",
        sizeBytes: 1234,
      }).pipe(Effect.provide(makeLayer({ storageError })), Effect.exit),
    );

    expect(getFailure(exit)).toBeInstanceOf(UploadStorageError);
  });
});
