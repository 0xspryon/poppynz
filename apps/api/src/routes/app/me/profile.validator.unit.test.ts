import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import { validateProfileUpdateInput } from './profile.validator';

describe('validateProfileUpdateInput (language)', () => {
  it('accepts en and fr, the languages the app speaks', async () => {
    for (const language of ['en', 'fr'] as const) {
      await expect(Effect.runPromise(validateProfileUpdateInput({ language }))).resolves.toEqual({
        language
      });
    }
  });

  it('rejects the retired es and anything else', async () => {
    for (const language of ['es', 'de', '']) {
      const exit = await Effect.runPromiseExit(validateProfileUpdateInput({ language }));
      expect(Exit.isFailure(exit)).toBe(true);
    }
  });
});
