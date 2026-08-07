import type { SqlError } from '@effect/sql/SqlError';
import {
  DBNotFoundError,
  TcDocumentRepo,
  type TcDocument,
  type TcDocumentAcceptance,
  type TcDocumentVersion,
  type TcPublishedDocument
} from '@repo/db';
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
  tcJsonError,
  validateTcAcceptInput,
  validateTcAudienceRole,
  validateTcDocumentCreateInput,
  validateTcDocumentUpdateInput,
  validateTcDraftInput,
  validateTcDraftUpdateInput
} from './tcs.validator';

class TcDocumentNotFoundError extends Data.TaggedError('TcDocumentNotFoundError')<{ id: string }> {}
class TcDraftNotFoundError extends Data.TaggedError('TcDraftNotFoundError')<{
  documentId: string;
}> {}
class TcDraftExistsError extends Data.TaggedError('TcDraftExistsError')<{ documentId: string }> {}
class TcSlugTakenError extends Data.TaggedError('TcSlugTakenError')<{ slug: string }> {}
/** The accepted versionId is no longer the latest published one. */
class TcVersionStaleError extends Data.TaggedError('TcVersionStaleError')<{ slug: string }> {}
class TcRepoError extends Data.TaggedError('TcRepoError')<{ cause: SqlError }> {}

function mapTcRepoError<A, R>(
  effect: Effect.Effect<A, SqlError, R>
): Effect.Effect<A, TcRepoError, R>;
function mapTcRepoError<A, R>(
  effect: Effect.Effect<A, SqlError | DBNotFoundError, R>
): Effect.Effect<A, TcRepoError | TcDocumentNotFoundError | TcDraftNotFoundError, R>;
function mapTcRepoError<A, R>(effect: Effect.Effect<A, SqlError | DBNotFoundError, R>) {
  return effect.pipe(
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new TcRepoError({ cause })),
      DBNotFoundError: (cause) =>
        cause.entity === 'tcDocumentVersion'
          ? Effect.fail(new TcDraftNotFoundError({ documentId: cause.value }))
          : Effect.fail(new TcDocumentNotFoundError({ id: cause.value }))
    })
  );
}

const toDateString = (date: Date | null | undefined) => date?.toISOString() ?? null;

const toTcDocumentResponse = (document: TcDocument) => ({
  ...document,
  createdAt: document.createdAt.toISOString(),
  updatedAt: document.updatedAt.toISOString(),
  deletedAt: toDateString(document.deletedAt)
});

const toTcVersionResponse = (version: TcDocumentVersion) => ({
  ...version,
  publishedAt: toDateString(version.publishedAt),
  createdAt: version.createdAt.toISOString(),
  updatedAt: version.updatedAt.toISOString()
});

/** Flattened document + latest published version, as shown to end users. */
const toPublishedTcResponse = ({ document, version }: TcPublishedDocument) => ({
  documentId: document.id,
  slug: document.slug,
  title: document.title,
  appliesToRole: document.appliesToRole,
  versionId: version.id,
  version: version.version,
  content: version.content,
  checkboxLabel: version.checkboxLabel,
  publishedAt: toDateString(version.publishedAt)
});

const toTcAcceptanceResponse = (acceptance: TcDocumentAcceptance) => ({
  ...acceptance,
  acceptedAt: acceptance.acceptedAt.toISOString()
});

// Public: signup shows the terms before a session exists, and any signed-in
// user may read another role's documents.
export const listPublishedTcsRouteProgram = (roleParam: string) =>
  Effect.gen(function* () {
    const role = yield* validateTcAudienceRole(roleParam);
    const repo = yield* TcDocumentRepo;
    const published = yield* repo
      .listPublishedForRole(role)
      .pipe((errors) => mapTcRepoError(errors));
    return published.map(toPublishedTcResponse);
  });

export const listPendingTcsRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { tcs: ['accept'] })(authenticated);
    const role = userAndSession.user.role;
    // Admins are never shown T&C — only the non-admin profiles are gated.
    if (role === null || role === 'admin') {
      return [];
    }

    const repo = yield* TcDocumentRepo;
    const pending = yield* repo
      .listPendingForUser(userAndSession.user.id, role)
      .pipe((errors) => mapTcRepoError(errors));
    return pending.map(toPublishedTcResponse);
  });

export const acceptTcsRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, tcJsonError);
    const input = yield* validateTcAcceptInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { tcs: ['accept'] })(authenticated);
    const repo = yield* TcDocumentRepo;

    // The client sends the version it actually displayed; if a publish raced
    // the modal, fail so the user re-reads the newer text instead of silently
    // "accepting" something they never saw.
    const items = yield* Effect.forEach(input.acceptances, (acceptance) =>
      Effect.gen(function* () {
        const document = yield* repo
          .findActiveBySlug(acceptance.slug)
          .pipe((errors) => mapTcRepoError(errors));
        const latest = yield* repo
          .findLatestPublished(document.id)
          .pipe((errors) => mapTcRepoError(errors));
        if (latest.id !== acceptance.versionId) {
          return yield* Effect.fail(new TcVersionStaleError({ slug: document.slug }));
        }

        return {
          documentId: document.id,
          slug: document.slug,
          versionId: latest.id,
          version: latest.version
        };
      })
    );
    const accepted = yield* repo
      .insertAcceptances(userAndSession.user.id, items)
      .pipe((errors) => mapTcRepoError(errors));
    return { accepted: accepted.map(toTcAcceptanceResponse) };
  });

const withVersions = (documents: Array<TcDocument>, versions: Array<TcDocumentVersion>) =>
  documents.map((document) => ({
    ...toTcDocumentResponse(document),
    versions: versions
      .filter((version) => version.documentId === document.id)
      .map(toTcVersionResponse)
  }));

export const listAdminTcsRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { tcs: ['write'] })(authenticated);
    const repo = yield* TcDocumentRepo;
    const documents = yield* repo.listActive().pipe((errors) => mapTcRepoError(errors));
    const versions = yield* repo
      .listVersionsByDocumentIds(documents.map((document) => document.id))
      .pipe((errors) => mapTcRepoError(errors));
    return withVersions(documents, versions);
  });

export const getAdminTcRouteProgram = (headers: Headers, id: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { tcs: ['write'] })(authenticated);
    const repo = yield* TcDocumentRepo;
    const document = yield* repo.findActiveById(id).pipe((errors) => mapTcRepoError(errors));
    const versions = yield* repo.listVersions(document.id).pipe((errors) => mapTcRepoError(errors));
    return { ...toTcDocumentResponse(document), versions: versions.map(toTcVersionResponse) };
  });

export const createTcDocumentRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, tcJsonError);
    const input = yield* validateTcDocumentCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { tcs: ['write'] })(authenticated);
    const repo = yield* TcDocumentRepo;
    const existing = yield* repo.findActiveBySlug(input.slug).pipe(
      Effect.map(Option.some),
      Effect.catchTag('DBNotFoundError', () => Effect.succeed(Option.none())),
      (errors) => mapTcRepoError(errors)
    );
    if (Option.isSome(existing)) {
      return yield* Effect.fail(new TcSlugTakenError({ slug: input.slug }));
    }

    const document = yield* repo.createDocument(input).pipe((errors) => mapTcRepoError(errors));
    return toTcDocumentResponse(document);
  });

export const updateTcDocumentRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  id: string
) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, tcJsonError);
    const input = yield* validateTcDocumentUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { tcs: ['write'] })(authenticated);
    const repo = yield* TcDocumentRepo;
    const document = yield* repo.updateDocument(id, input).pipe((errors) => mapTcRepoError(errors));
    return toTcDocumentResponse(document);
  });

export const deleteTcDocumentRouteProgram = (headers: Headers, id: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { tcs: ['write'] })(authenticated);
    const repo = yield* TcDocumentRepo;
    const document = yield* repo.softDeleteDocument(id).pipe((errors) => mapTcRepoError(errors));
    return toTcDocumentResponse(document);
  });

export const createTcDraftRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers, id: string) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, tcJsonError);
    const input = yield* validateTcDraftInput(rawBody);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { tcs: ['write'] })(authenticated);
    const repo = yield* TcDocumentRepo;
    const versions = yield* repo.listVersions(id).pipe((errors) => mapTcRepoError(errors));
    if (versions.some((version) => version.publishedAt === null)) {
      return yield* Effect.fail(new TcDraftExistsError({ documentId: id }));
    }

    const draft = yield* repo.createDraft(id, input).pipe((errors) => mapTcRepoError(errors));
    return toTcVersionResponse(draft);
  });

export const updateTcDraftRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers, id: string) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, tcJsonError);
    const input = yield* validateTcDraftUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { tcs: ['write'] })(authenticated);
    const repo = yield* TcDocumentRepo;
    const draft = yield* repo.updateDraft(id, input).pipe((errors) => mapTcRepoError(errors));
    return toTcVersionResponse(draft);
  });

export const publishTcDraftRouteProgram = (headers: Headers, id: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { tcs: ['write'] })(authenticated);
    const repo = yield* TcDocumentRepo;
    const published = yield* repo.publishDraft(id).pipe((errors) => mapTcRepoError(errors));
    return toTcVersionResponse(published);
  });

export type TcRouteError =
  | Effect.Effect.Error<ReturnType<typeof listPublishedTcsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listPendingTcsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof acceptTcsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listAdminTcsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getAdminTcRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof createTcDocumentRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof updateTcDocumentRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof deleteTcDocumentRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof createTcDraftRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof updateTcDraftRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof publishTcDraftRouteProgram>>;

const tcErrorToResponse = (c: HonoContext<HonoEnv>, error: TcRouteError) => {
  if (isAuthError(error)) return authErrorToResponse(c, error);
  if (isRequestValidationError(error)) return requestValidationErrorToResponse(c, error);

  switch (error._tag) {
    case 'TcDocumentNotFoundError':
      return c.json(
        {
          error: {
            code: 'TC_DOCUMENT_NOT_FOUND' as const,
            message: 'Terms and conditions document was not found.'
          }
        },
        404
      );
    case 'TcDraftNotFoundError':
      return c.json(
        {
          error: { code: 'TC_DRAFT_NOT_FOUND' as const, message: 'The document has no open draft.' }
        },
        404
      );
    case 'TcDraftExistsError':
      return c.json(
        {
          error: {
            code: 'TC_DRAFT_EXISTS' as const,
            message: 'The document already has an open draft.'
          }
        },
        409
      );
    case 'TcSlugTakenError':
      return c.json(
        {
          error: {
            code: 'TC_SLUG_TAKEN' as const,
            message: 'A document with this slug already exists.'
          }
        },
        409
      );
    case 'TcVersionStaleError':
      return c.json(
        {
          error: {
            code: 'TC_VERSION_STALE' as const,
            message: 'A newer version was published. Reload the terms and accept again.'
          }
        },
        409
      );
    case 'TcRepoError':
      return c.json(
        {
          error: {
            code: 'TC_REPO_ERROR' as const,
            message: 'Unable to process terms and conditions request.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, TcRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return tcErrorToResponse(c, failure.value);
      }

      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function listPublishedTcsHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const role = c.req.param('role') ?? '';
  const exit = await runtime.runPromiseExit(listPublishedTcsRouteProgram(role));
  return exitToResponse(c, exit);
}

export async function listPendingTcsHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(listPendingTcsRouteProgram(headers));
  return exitToResponse(c, exit);
}

export async function acceptTcsHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(acceptTcsRouteProgram(c, headers));
  return exitToResponse(c, exit);
}

export async function listAdminTcsHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(listAdminTcsRouteProgram(headers));
  return exitToResponse(c, exit);
}

export async function getAdminTcHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(getAdminTcRouteProgram(headers, id));
  return exitToResponse(c, exit);
}

export async function createTcDocumentHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(createTcDocumentRouteProgram(c, headers));
  return exitToResponse(c, exit);
}

export async function updateTcDocumentHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(updateTcDocumentRouteProgram(c, headers, id));
  return exitToResponse(c, exit);
}

export async function deleteTcDocumentHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(deleteTcDocumentRouteProgram(headers, id));
  return exitToResponse(c, exit);
}

export async function createTcDraftHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(createTcDraftRouteProgram(c, headers, id));
  return exitToResponse(c, exit);
}

export async function updateTcDraftHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(updateTcDraftRouteProgram(c, headers, id));
  return exitToResponse(c, exit);
}

export async function publishTcDraftHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(publishTcDraftRouteProgram(headers, id));
  return exitToResponse(c, exit);
}
