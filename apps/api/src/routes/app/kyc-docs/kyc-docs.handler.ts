import type { SqlError } from "@effect/sql/SqlError";
import { DBNotFoundError, KycDocumentRepo, type KycDocumentType, type KycDocument, KycDocumentTypeRepo } from "@repo/db";
import { objectBucketsConfig } from "@repo/env";
import { ObjectStorage, type ObjectStorageError } from "@repo/objs";
import type { ConfigError } from "effect/ConfigError";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { authErrorToResponse, authenticate, handleNever, isAuthError, requirePermissions } from "@/api/lib/effect-auth";
import { isRequestValidationError, parseJsonBody, requestValidationErrorToResponse } from "@/api/lib/schema-validator";
import {
  kycDocJsonError,
  kycDocTypeJsonError,
  validateKycDocumentExpiryUpdateInput,
  validateKycDocumentSubmitInput,
  validateKycDocumentTypeCreateInput,
  validateKycDocumentTypeUpdateInput,
} from "./kyc-docs.validator";

class KycValidationError extends Data.TaggedError("KycValidationError")<{ message: string }> { }
class KycNotFoundError extends Data.TaggedError("KycNotFoundError")<{ entity: "document" | "documentType" }> { }
class KycRepoError extends Data.TaggedError("KycRepoError")<{ cause: SqlError }> { }
class KycFileMissingError extends Data.TaggedError("KycFileMissingError")<{}> { }
class KycFileUrlError extends Data.TaggedError("KycFileUrlError")<{ cause: ObjectStorageError | ConfigError }> { }

const fileViewUrlTtlSeconds = 5 * 60;

function mapKycRepoError<A, R>(effect: Effect.Effect<A, SqlError, R>): Effect.Effect<A, KycRepoError, R>;
function mapKycRepoError<A, R>(effect: Effect.Effect<A, SqlError | DBNotFoundError, R>): Effect.Effect<A, KycRepoError | KycNotFoundError, R>;
function mapKycRepoError<A, R>(effect: Effect.Effect<A, SqlError | DBNotFoundError, R>) {
  return effect.pipe(
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new KycRepoError({ cause })),
      DBNotFoundError: (cause) => Effect.fail(new KycNotFoundError({ entity: cause.entity === "kycDocument" ? "document" : "documentType" })),
    }),
  );
}

const parseFutureDate = (value: string | null | undefined, required: boolean) => {
  if (!value) {
    return required ? Effect.fail(new KycValidationError({ message: "Expiry date is required." })) : Effect.succeed(null);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date <= new Date()) {
    return Effect.fail(new KycValidationError({ message: "Expiry date must be a valid future date." }));
  }

  return Effect.succeed(date);
};

const ensureServiceProvider = <T extends { user: { role: string | null } }>(userAndSession: T) =>
  userAndSession.user.role === "service-provider"
    ? Effect.succeed(userAndSession)
    : Effect.fail(new KycValidationError({ message: "Only service providers can submit KYC documents." }));

const ensureOwnFileKey = (userId: string, fileKey: string) =>
  fileKey.startsWith(`users/${userId}/`)
    ? Effect.void
    : Effect.fail(new KycValidationError({ message: "File key does not belong to the authenticated user." }));

const toDateString = (date: Date | null | undefined) => date?.toISOString() ?? null;
const toKycTypeResponse = (type: KycDocumentType) => ({ ...type, createdAt: type.createdAt.toISOString(), updatedAt: type.updatedAt.toISOString(), deletedAt: toDateString(type.deletedAt) });
const toKycDocResponse = (doc: KycDocument) => ({ ...doc, expiryDate: toDateString(doc.expiryDate), createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString(), deletedAt: toDateString(doc.deletedAt) });

export const listKycDocumentTypesRouteProgram = () =>
  Effect.gen(function* () {
    const repo = yield* KycDocumentTypeRepo;
    const types = yield* mapKycRepoError(repo.listActive());
    return types.map(toKycTypeResponse);
  });

export const createKycDocumentTypeRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, kycDocTypeJsonError);
    const input = yield* validateKycDocumentTypeCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { kycDocumentType: ["write"] })(authenticated);
    const repo = yield* KycDocumentTypeRepo;
    const type = yield* mapKycRepoError(repo.create({ ...input, appliesToRole: input.appliesToRole ?? "service-provider" }));
    return toKycTypeResponse(type);
  });

export const updateKycDocumentTypeRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers, id: string) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, kycDocTypeJsonError);
    const input = yield* validateKycDocumentTypeUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { kycDocumentType: ["write"] })(authenticated);
    const repo = yield* KycDocumentTypeRepo;
    const type = yield* mapKycRepoError(repo.update(id, input));
    return toKycTypeResponse(type);
  });

export const deleteKycDocumentTypeRouteProgram = (headers: Headers, id: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { kycDocumentType: ["write"] })(authenticated);
    const repo = yield* KycDocumentTypeRepo;
    const type = yield* mapKycRepoError(repo.softDelete(id));
    return toKycTypeResponse(type);
  });

export const submitKycDocumentRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, kycDocJsonError);
    const input = yield* validateKycDocumentSubmitInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { kycDocument: ["write"] })(authenticated);
    const provider = yield* ensureServiceProvider(userAndSession);
    const typeRepo = yield* KycDocumentTypeRepo;
    const documentType = yield* mapKycRepoError(typeRepo.findActiveById(input.documentTypeId));
    if (documentType.appliesToRole !== provider.user.role) {
      return yield* Effect.fail(new KycValidationError({ message: "KYC document type is not available for this role." }));
    }
    yield* ensureOwnFileKey(provider.user.id, input.fileKey);
    const expiryDate = yield* parseFutureDate(input.expiryDate, documentType.requiresExpiryDate);
    const docRepo = yield* KycDocumentRepo;
    const doc = yield* mapKycRepoError(docRepo.submit({
      userId: provider.user.id,
      documentTypeId: input.documentTypeId,
      filename: input.filename,
      fileKey: input.fileKey,
      expiryDate,
    }));
    return toKycDocResponse(doc);
  });

export const updateAdminKycDocumentRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers, id: string) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, kycDocJsonError);
    const input = yield* validateKycDocumentExpiryUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { kycDocument: ["write"] })(authenticated);
    const docRepo = yield* KycDocumentRepo;
    const existing = yield* mapKycRepoError(docRepo.findByIdWithType(id));
    const expiryDate = yield* parseFutureDate(input.expiryDate, existing.documentType.requiresExpiryDate);
    const doc = yield* mapKycRepoError(docRepo.updateExpiryDate(id, expiryDate));
    return toKycDocResponse(doc);
  });

// The admin document viewer renders the file in-browser only: short-lived
// presigned URL, inline disposition — no download affordance on our side.
export const getAdminKycDocumentFileUrlRouteProgram = (headers: Headers, id: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { kycDocument: ["read"] })(authenticated);
    const docRepo = yield* KycDocumentRepo;
    const doc = yield* mapKycRepoError(docRepo.findByIdWithType(id));
    if (!doc.fileKey) {
      return yield* Effect.fail(new KycFileMissingError());
    }
    const objectStorage = yield* ObjectStorage;
    const buckets = yield* objectBucketsConfig.pipe(
      Effect.mapError((cause) => new KycFileUrlError({ cause })),
    );
    const presigned = yield* objectStorage
      .createPresignedGetUrl({
        bucket: buckets.kycBucket,
        key: doc.fileKey,
        expiresInSeconds: fileViewUrlTtlSeconds,
        contentDisposition: "inline",
      })
      .pipe(Effect.mapError((cause) => new KycFileUrlError({ cause })));

    return {
      url: presigned.url,
      expiresAt: presigned.expiresAt.toISOString(),
      document: {
        id: doc.id,
        userId: doc.userId,
        filename: doc.filename,
        status: doc.status,
        expiryDate: toDateString(doc.expiryDate),
        submittedAt: doc.createdAt.toISOString(),
      },
      documentType: {
        id: doc.documentType.id,
        name: doc.documentType.name,
        requiresExpiryDate: doc.documentType.requiresExpiryDate,
      },
    };
  });

export type KycDocsRouteError =
  | Effect.Effect.Error<ReturnType<typeof listKycDocumentTypesRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof createKycDocumentTypeRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof updateKycDocumentTypeRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof deleteKycDocumentTypeRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof submitKycDocumentRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof updateAdminKycDocumentRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getAdminKycDocumentFileUrlRouteProgram>>;

const kycDocsErrorToResponse = (c: HonoContext<HonoEnv>, error: KycDocsRouteError) => {
  if (isAuthError(error)) return authErrorToResponse(c, error);
  if (isRequestValidationError(error)) return requestValidationErrorToResponse(c, error);

  switch (error._tag) {
    case "KycValidationError":
      return c.json({ error: { code: "INVALID_KYC_DOCUMENT" as const, message: error.message } }, 400);
    case "KycNotFoundError":
      return c.json(
        {
          error: {
            code: error.entity === "document" ? "KYC_DOCUMENT_NOT_FOUND" as const : "KYC_DOCUMENT_TYPE_NOT_FOUND" as const,
            message: error.entity === "document" ? "KYC document was not found." : "KYC document type was not found.",
          },
        },
        404,
      );
    case "KycRepoError":
      return c.json({ error: { code: "KYC_REPO_ERROR" as const, message: "Unable to process KYC document request." } }, 500);
    case "KycFileMissingError":
      return c.json({ error: { code: "KYC_DOCUMENT_FILE_MISSING" as const, message: "KYC document has no stored file." } }, 404);
    case "KycFileUrlError":
      return c.json({ error: { code: "KYC_FILE_URL_FAILED" as const, message: "Unable to create a file view link." } }, 502);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, KycDocsRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return kycDocsErrorToResponse(c, failure.value);
      }

      return c.json({ error: { code: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected server error." } }, 500);
    },
  });

export async function listKycDocumentTypesHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const exit = await runtime.runPromiseExit(
    listKycDocumentTypesRouteProgram(),
  );
  return exitToResponse(c, exit);
}

export async function createKycDocumentTypeHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    createKycDocumentTypeRouteProgram(c, headers),
  );
  return exitToResponse(c, exit);
}

export async function updateKycDocumentTypeHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const id = c.req.param("id") ?? "";
  const exit = await runtime.runPromiseExit(
    updateKycDocumentTypeRouteProgram(c, headers, id),
  );
  return exitToResponse(c, exit);
}

export async function deleteKycDocumentTypeHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const id = c.req.param("id") ?? "";
  const exit = await runtime.runPromiseExit(
    deleteKycDocumentTypeRouteProgram(headers, id),
  );
  return exitToResponse(c, exit);
}

export async function submitKycDocumentHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    submitKycDocumentRouteProgram(c, headers),
  );
  return exitToResponse(c, exit);
}

export async function updateAdminKycDocumentHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const id = c.req.param("id") ?? "";
  const exit = await runtime.runPromiseExit(
    updateAdminKycDocumentRouteProgram(c, headers, id),
  );
  return exitToResponse(c, exit);
}

export async function getAdminKycDocumentFileUrlHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const id = c.req.param("id") ?? "";
  const exit = await runtime.runPromiseExit(
    getAdminKycDocumentFileUrlRouteProgram(headers, id),
  );
  return exitToResponse(c, exit);
}
