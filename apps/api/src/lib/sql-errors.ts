import type { SqlError } from '@effect/sql/SqlError';

/** Postgres unique-constraint violation (SQLSTATE 23505), possibly nested a
 * few `cause` levels deep depending on the driver wrapping. */
export const isUniqueViolation = (error: SqlError): boolean => {
  let current: unknown = error.cause;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth++) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};
