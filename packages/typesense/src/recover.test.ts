import { describe, expect, it } from 'bun:test';
import { Effect, Exit } from 'effect';
import { recoverFromMissingCollection } from './recover';

describe('recoverFromMissingCollection (UAT #26)', () => {
  it('answers empty and creates the collection when it is missing', async () => {
    let ensured = 0;
    const result = await Effect.runPromise(
      recoverFromMissingCollection({
        error: { cause: { httpStatus: 404 } },
        empty: { providers: [] as Array<string> },
        collection: 'providers',
        ensureCollection: () => Effect.sync(() => void (ensured += 1))
      })
    );
    expect(result).toEqual({ providers: [] });
    expect(ensured).toBe(1);
  });

  it('still answers empty if creating the collection fails', async () => {
    const result = await Effect.runPromise(
      recoverFromMissingCollection({
        error: { cause: { status: 404 } },
        empty: 0,
        collection: 'providers',
        ensureCollection: () => Effect.fail('down')
      })
    );
    expect(result).toBe(0);
  });

  it('passes any other failure on', async () => {
    const error = { cause: new Error('connection refused') };
    const exit = await Effect.runPromiseExit(
      recoverFromMissingCollection({
        error,
        empty: 0,
        collection: 'providers',
        ensureCollection: () => Effect.void
      })
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
