import { objectBucketsConfig } from "@repo/env";
import { KycDocumentTypeRepo } from "@repo/db";
import { ObjectStorage, ObjectStorageError } from "@repo/objs";
import type { ConfigError } from "effect/ConfigError";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions,
  type UserAndSession
} from "@/api/lib/effect-auth";
import {
  uploadPresignJsonError,
  validateUploadPresignInput,
  type UploadPresignInput,
} from "./upload.validator";
import type { Roles } from "@/api/lib/auth-roles";
import {
  parseJsonBody,
  requestValidationErrorToResponse,
} from "@/api/lib/schema-validator";

const uploadUrlTtlSeconds = 10 * 60;
const maxKycDocumentSizeBytes = 50 * 1024 * 1024;
const maxPublicImageSizeBytes = 5 * 1024 * 1024;
const allowedKycContentTypes = new Set([
  "application/pdf", "image/jpeg",
  "image/png", "image/webp"
]);
const allowedPublicImageContentTypes = new Set([
  "image/jpeg", "image/png", "image/webp"
]);

export class UploadConfigError extends Data.TaggedError("UploadConfigError")<{
  cause: ConfigError;
}> { }

export class UploadValidationError extends Data.TaggedError("UploadValidationError")<{
  message: string;
}> { }

export class UploadStorageError extends Data.TaggedError("UploadStorageError")<{
  cause: ObjectStorageError;
}> { }

const sanitizeFileName = (fileName: string) => {
  const normalized = fileName.trim().replace(/[^a-zA-Z0-9._-]/gm, "-").replace(/-+/g, "-");

  return normalized.length > 0 ? normalized.slice(0, 160) : "upload";
};

const validateUploadInput = (userRole: Roles | null, input: UploadPresignInput) =>
  Effect.gen(function*() {
    if (input.target === "kyc-document") {
      if (userRole !== "service-provider") {
        return yield* Effect.fail(new UploadValidationError({ message: "Only service providers can upload KYC documents." }));
      }

      const documentTypeRepo = yield* KycDocumentTypeRepo;
      const documentType = yield* documentTypeRepo.findActiveById(input.documentTypeId).pipe(
        Effect.mapError(() => new UploadValidationError({ message: "KYC document type was not found." })),
      );

      if (documentType.appliesToRole !== userRole) {
        return yield* Effect.fail(new UploadValidationError({ message: "KYC document type is not available for this role." }));
      }

      if (!allowedKycContentTypes.has(input.contentType)) {
        return yield* Effect.fail(new UploadValidationError({ message: "Unsupported KYC document file type." }));
      }

      if (input.sizeBytes > maxKycDocumentSizeBytes) {
        return yield* Effect.fail(new UploadValidationError({ message: "KYC document is too large." }));
      }

      return;
    }

    if (!allowedPublicImageContentTypes.has(input.contentType)) {
      return yield* Effect.fail(new UploadValidationError({ message: "Unsupported public image file type." }));
    }

    if (input.sizeBytes > maxPublicImageSizeBytes) {
      return yield* Effect.fail(new UploadValidationError({ message: "Public image is too large." }));
    }
  });

const buildObjectKey = (userId: string, input: UploadPresignInput) => {
  const safeName = sanitizeFileName(input.fileName);
  const uploadId = crypto.randomUUID();

  if (input.target === "kyc-document") {
    return `users/${userId}/kyc/${input.documentTypeId}/${uploadId}-${safeName}`;
  }

  return `users/${userId}/public/profile-pictures/${uploadId}-${safeName}`;
};

export const createUploadPresignProgram = (userAndSession: UserAndSession, input: UploadPresignInput) =>
  Effect.gen(function*() {
    const objectStorage = yield* ObjectStorage;
    const buckets = yield* objectBucketsConfig.pipe(
      Effect.mapError((cause) => new UploadConfigError({ cause })),
    );

    yield* validateUploadInput(userAndSession.user.role, input);

    const bucket = input.target === "kyc-document" ? buckets.kycBucket : buckets.publicBucket;
    const fileKey = buildObjectKey(userAndSession.user.id, input);
    const presignedUrl = yield* objectStorage
      .createPresignedPutUrl({
        bucket,
        key: fileKey,
        contentType: input.contentType,
        expiresInSeconds: uploadUrlTtlSeconds,
      })
      .pipe(Effect.mapError((cause) => new UploadStorageError({ cause })));

    return {
      bucket,
      fileKey,
      uploadUrl: presignedUrl.uploadUrl,
      expiresAt: presignedUrl.expiresAt.toISOString(),
    };
  });

export type UploadError = Effect.Effect.Error<ReturnType<typeof createUploadPresignProgram>>;

const uploadErrorToResponse = (c: HonoContext<HonoEnv>, error: UploadError) => {
  switch (error._tag) {
    case "UploadConfigError":
      return c.json(
        {
          error: {
            code: "UPLOAD_CONFIG_ERROR" as const,
            message: "Upload storage is not configured.",
          },
        },
        500,
      );
    case "UploadValidationError":
      return c.json(
        {
          error: {
            code: "INVALID_UPLOAD" as const,
            message: error.message,
          },
        },
        400,
      );
    case "UploadStorageError":
      return c.json(
        {
          error: {
            code: "UPLOAD_PRESIGN_FAILED" as const,
            message: "Unable to prepare upload.",
          },
        },
        500,
      );
    default:
      return handleNever(c, error);
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

export const createUploadPresignRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function*() {
    const rawBody = yield* parseJsonBody(c, uploadPresignJsonError);
    const input = yield* validateUploadPresignInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(
      headers,
      { profile: ["update"] },
    )(authenticated);

    return yield* createUploadPresignProgram(userAndSession, input);
  });

export type UploadRouteError = Effect.Effect.Error<ReturnType<typeof createUploadPresignRouteProgram>>;

const uploadRouteErrorToResponse = (c: HonoContext<HonoEnv>, error: UploadRouteError) => {
  switch (error._tag) {
    case "UnauthorizedError":
    case "ForbiddenError":
    case "AuthProviderError":
    case "AuthEntityLookupError":
      return authErrorToResponse(c, error);
    case "RequestValidationError":
      return requestValidationErrorToResponse(c, error);
    case "UploadConfigError":
    case "UploadValidationError":
    case "UploadStorageError":
      return uploadErrorToResponse(c, error);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <TUpload>(c: HonoContext<HonoEnv>, exit: Exit.Exit<TUpload, UploadRouteError>) =>
  Exit.match(exit, {
    onSuccess: (upload) => c.json(upload),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        return uploadRouteErrorToResponse(c, failure.value);
      }

      return unexpectedErrorResponse(c);
    },
  });

export async function createUploadPresignHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    createUploadPresignRouteProgram(c, headers),
  );

  return exitToResponse(c, exit);
}
