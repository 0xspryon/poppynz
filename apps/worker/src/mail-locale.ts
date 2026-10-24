import { UserProfileRepo } from '@repo/db';
import { defaultMailLocale, toMailLocale } from '@repo/mail';
import { Effect } from 'effect';

/** The language a user's mails are written in: their profile's language, or
 * English when they have no profile or the lookup fails. Never fails — a
 * reminder must not be lost to the locale lookup. (Mirrors the api's
 * `userMailLocale`.) */
export const userMailLocale = (userId: string) =>
  UserProfileRepo.pipe(
    Effect.flatMap((repo) => repo.findByUserId(userId)),
    Effect.map((profile) => toMailLocale(profile.language)),
    Effect.orElseSucceed(() => defaultMailLocale)
  );
