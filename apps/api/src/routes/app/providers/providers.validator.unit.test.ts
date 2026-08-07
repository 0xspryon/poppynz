import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import { validateProviderSearchQuery } from './providers.validator';

const run = (query: Record<string, string | undefined>) =>
  Effect.runPromiseExit(validateProviderSearchQuery(query));

const failureMessage = (exit: Exit.Exit<unknown, { message: string }>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected validation to fail');
  const error = exit.cause._tag === 'Fail' ? exit.cause.error : null;
  return error?.message ?? '';
};

describe('provider search pagination validation', () => {
  it('defaults page and perPage when absent', async () => {
    const result = await Effect.runPromise(validateProviderSearchQuery({}));
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(20);
  });

  it('accepts values at the maximum bounds', async () => {
    const result = await Effect.runPromise(
      validateProviderSearchQuery({ page: '100', perPage: '50' })
    );
    expect(result.page).toBe(100);
    expect(result.perPage).toBe(50);
  });

  it('rejects page above the maximum', async () => {
    expect(failureMessage(await run({ page: '101' }))).toBe('page must be 100 or less.');
  });

  it('rejects perPage above the maximum', async () => {
    expect(failureMessage(await run({ perPage: '51' }))).toBe('perPage must be 50 or less.');
  });

  it('rejects trailing-garbage numerics that parseInt would accept', async () => {
    expect(failureMessage(await run({ perPage: '20x' }))).toBe(
      'perPage must be a positive integer.'
    );
  });

  it('rejects zero and negative pages', async () => {
    expect(failureMessage(await run({ page: '0' }))).toBe('page must be a positive integer.');
    expect(failureMessage(await run({ page: '-3' }))).toBe('page must be a positive integer.');
  });
});
