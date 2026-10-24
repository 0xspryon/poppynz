import { Effect } from 'effect';

const isNotFound = (cause: unknown) => {
  if (!cause || typeof cause !== 'object') return false;
  const error = cause as { httpStatus?: number; status?: number };
  return error.httpStatus === 404 || error.status === 404;
};

/**
 * A search against a collection (or alias) that doesn't exist yet — a fresh
 * environment, or a collection-version bump before the first reindex — used
 * to surface as a 502 on every search (UAT #26). Treat it as an empty index:
 * log it, create the collection and alias so writes land, and answer with no
 * results until the reindex fills it. Any other failure is logged with its
 * cause and passed on.
 */
export const recoverFromMissingCollection = <A, E extends { cause: unknown }>(input: {
  error: E;
  empty: A;
  collection: string;
  ensureCollection: () => Effect.Effect<void, unknown>;
}): Effect.Effect<A, E> =>
  isNotFound(input.error.cause)
    ? Effect.logError(
        `typesense: collection "${input.collection}" not found during search — creating it; run the admin reindex to repopulate it`
      ).pipe(
        Effect.zipRight(input.ensureCollection().pipe(Effect.catchAll(() => Effect.void))),
        Effect.as(input.empty)
      )
    : Effect.logError(`typesense: search on "${input.collection}" failed`, input.error.cause).pipe(
        Effect.zipRight(Effect.fail(input.error))
      );

