import type { SqlError } from '@effect/sql/SqlError';
import {
  CheckOrderRepo,
  DBNotFoundError,
  KycDocumentRepo,
  type KycDocumentType,
  type KycDocument,
  KycDocumentTypeRepo
} from '@repo/db';
import { objectBucketsConfig } from '@repo/env';
import { ObjectStorage, type ObjectStorageError } from '@repo/objs';
import type { ConfigError } from 'effect/ConfigError';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  isAuthError,
  requirePermissions
} from '@/api/lib/effect-auth';
import {
  isRequestValidationError,
  parseJsonBody,
  requestValidationErrorToResponse
} from '@/api/lib/schema-validator';
import {
  kycDocJsonError,
  kycDocTypeJsonError,
  validateKycDocumentExpiryUpdateInput,
  validateKycDocumentSubmitInput,
  validateKycDocumentTypeCreateInput,
  validateKycDocumentTypeUpdateInput
} from './kyc-docs.validator';

class KycValidationError extends Data.TaggedError('KycValidationError')<{ message: string }> {}
class KycNotFoundError extends Data.TaggedError('KycNotFoundError')<{
  entity: 'document' | 'documentType';
}> {}
class KycRepoError extends Data.TaggedError('KycRepoError')<{ cause: SqlError }> {}
class KycDocumentTypeConflictError extends Data.TaggedError('KycDocumentTypeConflictError')<{
  message: string;
}> {}
class KycFileMissingError extends Data.TaggedError('KycFileMissingError')<{}> {}
class KycFileUrlError extends Data.TaggedError('KycFileUrlError')<{
  cause: ObjectStorageError | ConfigError;
}> {}

const fileViewUrlTtlSeconds = 5 * 60;

function mapKycRepoError<A, R>(
  effect: Effect.Effect<A, SqlError, R>
): Effect.Effect<A, KycRepoError, R>;
function mapKycRepoError<A, R>(
  effect: Effect.Effect<A, SqlError | DBNotFoundError, R>
): Effect.Effect<A, KycRepoError | KycNotFoundError, R>;
function mapKycRepoError<A, R>(effect: Effect.Effect<A, SqlError | DBNotFoundError, R>) {
  return effect.pipe(
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new KycRepoError({ cause })),
      DBNotFoundError: (cause) =>
        Effect.fail(
          new KycNotFoundError({
            entity: cause.entity === 'kycDocument' ? 'document' : 'documentType'
          })
        )
    })
  );
}

const parseFutureDate = (value: string | null | undefined, required: boolean) => {
  if (!value) {
    return required
      ? Effect.fail(new KycValidationError({ message: 'Expiry date is required.' }))
      : Effect.succeed(null);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date <= new Date()) {
    return Effect.fail(
      new KycValidationError({ message: 'Expiry date must be a valid future date.' })
    );
  }

  return Effect.succeed(date);
};

/** Both applicant roles have a document checklist; which types they may
 * submit is decided by the type's own `appliesToRole` below. */
const ensureApplicant = <T extends { user: { role: string | null } }>(
  userAndSession: T
): Effect.Effect<T & { user: { role: 'service-provider' | 'family' } }, KycValidationError> =>
  userAndSession.user.role === 'service-provider' || userAndSession.user.role === 'family'
    ? Effect.succeed(userAndSession as T & { user: { role: 'service-provider' | 'family' } })
    : Effect.fail(
        new KycValidationError({
          message: 'Only families and service providers can submit KYC documents.'
        })
      );

const ensureOwnFileKey = (userId: string, fileKey: string) =>
  fileKey.startsWith(`users/${userId}/`)
    ? Effect.void
    : Effect.fail(
        new KycValidationError({ message: 'File key does not belong to the authenticated user.' })
      );

const toDateString = (date: Date | null | undefined) => date?.toISOString() ?? null;
const toKycTypeResponse = (type: KycDocumentType) => ({
  ...type,
  createdAt: type.createdAt.toISOString(),
  updatedAt: type.updatedAt.toISOString(),
  deletedAt: toDateString(type.deletedAt)
});
const toKycDocResponse = (doc: KycDocument) => ({
  ...doc,
  expiryDate: toDateString(doc.expiryDate),
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
  deletedAt: toDateString(doc.deletedAt)
});

/**
 * A document type is either upload-only or a priced Credibled check — never
 * half-configured.
 *
 * Without this an admin could mark a type fetchable with no price and the
 * applicant would be quoted nothing for a check Poppynz still pays for.
 * Checked against the MERGED state so a partial PATCH can't sneak past it.
 */
const ensureFetchablePricing = (merged: {
  credibledCheckTypeValue: string | null;
  credibledCostCents: number | null;
}) => {
  if (merged.credibledCheckTypeValue !== null && merged.credibledCostCents === null) {
    return Effect.fail(
      new KycValidationError({
        message: 'Set a price before making a document type fetchable via Credibled.'
      })
    );
  }
  if (merged.credibledCheckTypeValue === null && merged.credibledCostCents !== null) {
    return Effect.fail(
      new KycValidationError({
        message: 'Only fetchable document types can carry a price.'
      })
    );
  }
  return Effect.void;
};

/**
 * One safety gate per role.
 *
 * Two gate types for the same role would put two checklist entries in front
 * of the applicant, both reading the same verdict. The partial unique index
 * is the backstop; this is the check that turns a violation into a message an
 * administrator can act on rather than a 500.
 */
const ensureSingleGate = (
  types: Array<KycDocumentType>,
  merged: { appliesToRole: KycDocumentType['appliesToRole']; isSafetyGate: boolean },
  excludingId: string | null
) => {
  if (!merged.isSafetyGate) {
    return Effect.void;
  }
  const clash = types.find(
    (type) =>
      type.id !== excludingId && type.isSafetyGate && type.appliesToRole === merged.appliesToRole
  );
  return clash
    ? Effect.fail(
        new KycDocumentTypeConflictError({
          message: `${clash.name} is already the safety gate for this role — a role has exactly one.`
        })
      )
    : Effect.void;
};

/**
 * Admin list order: the newest type first so the one just created is in
 * view, then everything else alphabetically by name. Ties on creation time
 * (bulk-seeded rows) fall back to name so the order is stable.
 */
export const orderKycDocumentTypesForAdmin = (types: ReadonlyArray<KycDocumentType>) => {
  const byName = (a: KycDocumentType, b: KycDocumentType) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const newest = types.reduce<KycDocumentType | null>((best, type) => {
    if (!best) return type;
    const delta = type.createdAt.getTime() - best.createdAt.getTime();
    return delta > 0 || (delta === 0 && byName(type, best) < 0) ? type : best;
  }, null);
  if (!newest) return [];
  const rest = types.filter((type) => type !== newest).sort(byName);
  return [newest, ...rest];
};

export const listKycDocumentTypesRouteProgram = () =>
  Effect.gen(function* () {
    const repo = yield* KycDocumentTypeRepo;
    const types = yield* mapKycRepoError(repo.listActive());
    return orderKycDocumentTypesForAdmin(types).map(toKycTypeResponse);
  });

export const createKycDocumentTypeRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, kycDocTypeJsonError);
    const input = yield* validateKycDocumentTypeCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { kycDocumentType: ['write'] })(authenticated);
    yield* ensureFetchablePricing({
      credibledCheckTypeValue: input.credibledCheckTypeValue ?? null,
      credibledCostCents: input.credibledCostCents ?? null
    });
    const repo = yield* KycDocumentTypeRepo;
    const appliesToRole = input.appliesToRole ?? 'service-provider';
    if (input.isSafetyGate) {
      const types = yield* mapKycRepoError(repo.listActive());
      yield* ensureSingleGate(types, { appliesToRole, isSafetyGate: true }, null);
    }
    const type = yield* mapKycRepoError(repo.create({ ...input, appliesToRole }));
    return toKycTypeResponse(type);
  });

export const updateKycDocumentTypeRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  id: string
) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, kycDocTypeJsonError);
    const input = yield* validateKycDocumentTypeUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { kycDocumentType: ['write'] })(authenticated);
    const repo = yield* KycDocumentTypeRepo;
    const current = yield* mapKycRepoError(repo.findActiveById(id));
    yield* ensureFetchablePricing({
      credibledCheckTypeValue:
        input.credibledCheckTypeValue !== undefined
          ? input.credibledCheckTypeValue
          : current.credibledCheckTypeValue,
      credibledCostCents:
        input.credibledCostCents !== undefined
          ? input.credibledCostCents
          : current.credibledCostCents
    });
    // Checked against the MERGED state, like pricing: a PATCH that only moves
    // the role, or only sets the flag, must not slip a second gate in.
    const merged = {
      appliesToRole: input.appliesToRole ?? current.appliesToRole,
      isSafetyGate: input.isSafetyGate ?? current.isSafetyGate
    };
    if (merged.isSafetyGate) {
      const types = yield* mapKycRepoError(repo.listActive());
      yield* ensureSingleGate(types, merged, id);
    }
    const type = yield* mapKycRepoError(repo.update(id, input));
    return toKycTypeResponse(type);
  });

export const deleteKycDocumentTypeRouteProgram = (headers: Headers, id: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { kycDocumentType: ['write'] })(authenticated);
    const repo = yield* KycDocumentTypeRepo;
    const type = yield* mapKycRepoError(repo.softDelete(id));
    return toKycTypeResponse(type);
  });

export const submitKycDocumentRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, kycDocJsonError);
    const input = yield* validateKycDocumentSubmitInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { kycDocument: ['write'] })(
      authenticated
    );
    const applicant = yield* ensureApplicant(userAndSession);
    const typeRepo = yield* KycDocumentTypeRepo;
    const documentType = yield* mapKycRepoError(typeRepo.findActiveById(input.documentTypeId));
    if (documentType.appliesToRole !== applicant.user.role) {
      return yield* Effect.fail(
        new KycValidationError({ message: 'KYC document type is not available for this role.' })
      );
    }
    // The safety-gate type is submitted through /safety-verification/document,
    // which also collects the issuing service and document number. Accepting
    // it here would create a second, parallel record that the safety gate
    // never reads.
    if (documentType.isSafetyGate) {
      return yield* Effect.fail(
        new KycValidationError({
          message: 'Submit this document through safety verification.'
        })
      );
    }

    yield* ensureOwnFileKey(applicant.user.id, input.fileKey);
    const expiryDate = yield* parseFutureDate(input.expiryDate, documentType.requiresExpiryDate);
    const docRepo = yield* KycDocumentRepo;
    const doc = yield* mapKycRepoError(
      docRepo.submit({
        userId: applicant.user.id,
        documentTypeId: input.documentTypeId,
        filename: input.filename,
        fileKey: input.fileKey,
        expiryDate
      })
    );

    // Uploading it yourself supersedes having Credibled fetch it: drop the
    // matching item from the unpaid basket so nobody is charged for a check
    // they have just provided. Best-effort — a failure here must not lose the
    // document the applicant just uploaded.
    yield* Effect.gen(function* () {
      const orders = yield* CheckOrderRepo;
      const open = yield* orders.findOpen(applicant.user.id, applicant.user.role);
      if (!open || open.status !== 'draft') {
        return;
      }
      const items = yield* orders.listItems(open.id);
      const queued = items.find((item) => item.documentTypeId === input.documentTypeId);
      if (queued) {
        yield* orders.removeItem(open.id, queued.id);
      }
    }).pipe(Effect.ignore);

    return toKycDocResponse(doc);
  });

export const updateAdminKycDocumentRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  id: string
) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, kycDocJsonError);
    const input = yield* validateKycDocumentExpiryUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { kycDocument: ['write'] })(authenticated);
    const docRepo = yield* KycDocumentRepo;
    const existing = yield* mapKycRepoError(docRepo.findByIdWithType(id));
    const expiryDate = yield* parseFutureDate(
      input.expiryDate,
      existing.documentType.requiresExpiryDate
    );
    const doc = yield* mapKycRepoError(docRepo.updateExpiryDate(id, expiryDate));
    return toKycDocResponse(doc);
  });

// The admin document viewer renders the file in-browser only: short-lived
// presigned URL, inline disposition — no download affordance on our side.
export const getAdminKycDocumentFileUrlRouteProgram = (headers: Headers, id: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { kycDocument: ['read'] })(authenticated);
    const docRepo = yield* KycDocumentRepo;
    const doc = yield* mapKycRepoError(docRepo.findByIdWithType(id));
    if (!doc.fileKey) {
      return yield* Effect.fail(new KycFileMissingError());
    }
    const objectStorage = yield* ObjectStorage;
    const buckets = yield* objectBucketsConfig.pipe(
      Effect.mapError((cause) => new KycFileUrlError({ cause }))
    );
    const presigned = yield* objectStorage
      .createPresignedGetUrl({
        bucket: buckets.kycBucket,
        key: doc.fileKey,
        expiresInSeconds: fileViewUrlTtlSeconds,
        contentDisposition: 'inline'
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
        submittedAt: doc.createdAt.toISOString()
      },
      documentType: {
        id: doc.documentType.id,
        name: doc.documentType.name,
        requiresExpiryDate: doc.documentType.requiresExpiryDate
      }
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
    case 'KycValidationError':
      return c.json(
        { error: { code: 'INVALID_KYC_DOCUMENT' as const, message: error.message } },
        400
      );
    case 'KycNotFoundError':
      return c.json(
        {
          error: {
            code:
              error.entity === 'document'
                ? ('KYC_DOCUMENT_NOT_FOUND' as const)
                : ('KYC_DOCUMENT_TYPE_NOT_FOUND' as const),
            message:
              error.entity === 'document'
                ? 'KYC document was not found.'
                : 'KYC document type was not found.'
          }
        },
        404
      );
    case 'KycDocumentTypeConflictError':
      return c.json(
        { error: { code: 'KYC_DOCUMENT_TYPE_CONFLICT' as const, message: error.message } },
        409
      );
    case 'KycRepoError':
      return c.json(
        {
          error: {
            code: 'KYC_REPO_ERROR' as const,
            message: 'Unable to process KYC document request.'
          }
        },
        500
      );
    case 'KycFileMissingError':
      return c.json(
        {
          error: {
            code: 'KYC_DOCUMENT_FILE_MISSING' as const,
            message: 'KYC document has no stored file.'
          }
        },
        404
      );
    case 'KycFileUrlError':
      return c.json(
        {
          error: {
            code: 'KYC_FILE_URL_FAILED' as const,
            message: 'Unable to create a file view link.'
          }
        },
        502
      );
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

      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function listKycDocumentTypesHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(listKycDocumentTypesRouteProgram());
  return exitToResponse(c, exit);
}

export async function createKycDocumentTypeHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(createKycDocumentTypeRouteProgram(c, headers));
  return exitToResponse(c, exit);
}

export async function updateKycDocumentTypeHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(updateKycDocumentTypeRouteProgram(c, headers, id));
  return exitToResponse(c, exit);
}

export async function deleteKycDocumentTypeHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(deleteKycDocumentTypeRouteProgram(headers, id));
  return exitToResponse(c, exit);
}

export async function submitKycDocumentHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(submitKycDocumentRouteProgram(c, headers));
  return exitToResponse(c, exit);
}

export async function updateAdminKycDocumentHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(updateAdminKycDocumentRouteProgram(c, headers, id));
  return exitToResponse(c, exit);
}

export async function getAdminKycDocumentFileUrlHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(getAdminKycDocumentFileUrlRouteProgram(headers, id));
  return exitToResponse(c, exit);
}
