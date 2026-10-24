import { DBNotFoundError, makeUserProfileRepoTest, makeUserRepoTest, type User } from '@repo/db';
import { SqlError } from '@effect/sql/SqlError';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { emailMailLocale, requestMailLocale, userMailLocale } from './mail-locale';

describe('requestMailLocale', () => {
  it('defaults to English without headers or preferences', () => {
    expect(requestMailLocale(undefined)).toBe('en');
    expect(requestMailLocale(null)).toBe('en');
    expect(requestMailLocale(new Headers())).toBe('en');
  });

  it('reads the Paraglide cookie first', () => {
    expect(
      requestMailLocale(
        new Headers({ cookie: 'session=abc; PARAGLIDE_LOCALE=fr', 'accept-language': 'en-CA' })
      )
    ).toBe('fr');
    expect(
      requestMailLocale(
        new Headers({ cookie: 'PARAGLIDE_LOCALE=en', 'accept-language': 'fr-CA,fr;q=0.9' })
      )
    ).toBe('en');
  });

  it('ignores an unsupported cookie value and falls through to Accept-Language', () => {
    expect(
      requestMailLocale(new Headers({ cookie: 'PARAGLIDE_LOCALE=es', 'accept-language': 'fr' }))
    ).toBe('fr');
    expect(requestMailLocale(new Headers({ cookie: 'XPARAGLIDE_LOCALE=fr' }))).toBe('en');
  });

  it('picks the most preferred supported Accept-Language entry', () => {
    expect(requestMailLocale(new Headers({ 'accept-language': 'fr-CA,fr;q=0.9,en;q=0.8' }))).toBe(
      'fr'
    );
    expect(requestMailLocale(new Headers({ 'accept-language': 'es-MX,fr;q=0.5,en;q=0.7' }))).toBe(
      'en'
    );
    expect(requestMailLocale(new Headers({ 'accept-language': 'en;q=0.2, fr;q=0.9' }))).toBe('fr');
    expect(requestMailLocale(new Headers({ 'accept-language': 'de, es' }))).toBe('en');
    expect(requestMailLocale(new Headers({ 'accept-language': 'fr;q=0, en' }))).toBe('en');
  });
});

const profiles = (languages: Record<string, string>, options: { sqlError?: boolean } = {}) =>
  makeUserProfileRepoTest({
    create: () => Effect.die('unused'),
    findByUserId: (userId) =>
      options.sqlError
        ? Effect.fail(new SqlError({ cause: 'down', message: 'down' }))
        : userId in languages
          ? Effect.succeed({ userId, language: languages[userId] } as never)
          : Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId })),
    updateByUserId: () => Effect.die('unused'),
    updateLocationByUserId: () => Effect.die('unused')
  });

const users = (byEmail: Record<string, string>) =>
  makeUserRepoTest({
    findById: () => Effect.die('unused'),
    findByEmail: (email) =>
      email in byEmail
        ? Effect.succeed({ id: byEmail[email], email } as unknown as User)
        : Effect.fail(new DBNotFoundError({ entity: 'user', value: email }))
  });

describe('userMailLocale', () => {
  it("returns the profile's language", async () => {
    await expect(
      Effect.runPromise(userMailLocale('u1').pipe(Effect.provide(profiles({ u1: 'fr' }))))
    ).resolves.toBe('fr');
  });

  it('treats a legacy or unknown stored language as English', async () => {
    await expect(
      Effect.runPromise(userMailLocale('u1').pipe(Effect.provide(profiles({ u1: 'es' }))))
    ).resolves.toBe('en');
  });

  it('falls back when the profile is missing or the lookup fails', async () => {
    await expect(
      Effect.runPromise(userMailLocale('u1', 'fr').pipe(Effect.provide(profiles({}))))
    ).resolves.toBe('fr');
    await expect(
      Effect.runPromise(
        userMailLocale('u1').pipe(Effect.provide(profiles({ u1: 'fr' }, { sqlError: true })))
      )
    ).resolves.toBe('en');
  });
});

describe('emailMailLocale', () => {
  const layer = (languages: Record<string, string>) =>
    Layer.mergeAll(users({ 'known@example.com': 'u1' }), profiles(languages));

  it("uses an existing user's profile language", async () => {
    await expect(
      Effect.runPromise(
        emailMailLocale('known@example.com', 'en').pipe(Effect.provide(layer({ u1: 'fr' })))
      )
    ).resolves.toBe('fr');
  });

  it('falls back for an unknown email or a user without a profile', async () => {
    await expect(
      Effect.runPromise(
        emailMailLocale('new@example.com', 'fr').pipe(Effect.provide(layer({ u1: 'en' })))
      )
    ).resolves.toBe('fr');
    await expect(
      Effect.runPromise(emailMailLocale('known@example.com', 'fr').pipe(Effect.provide(layer({}))))
    ).resolves.toBe('fr');
  });
});
