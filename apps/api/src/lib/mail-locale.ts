import { UserProfileRepo, UserRepo } from '@repo/db';
import { Effect } from 'effect';
import { LOCALE_COOKIE_NAME } from './constants';
import { defaultMailLocale, toMailLocale, type MailLocale } from './mailer';

const readCookie = (cookieHeader: string, name: string) => {
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      const raw = part.slice(separator + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
};

const supportedLocale = (value: string): MailLocale | null => {
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  return primary === 'fr' ? 'fr' : primary === 'en' ? 'en' : null;
};

/** The language a request asks for, as the api's languageDetector reads it:
 * the web app's Paraglide cookie, then Accept-Language (by q-value), then
 * English. Pure — for mails sent outside a Hono context (better-auth hooks),
 * where `c.get('language')` is not available. */
export const requestMailLocale = (headers: Headers | null | undefined): MailLocale => {
  if (!headers) return defaultMailLocale;

  const cookie = readCookie(headers.get('cookie') ?? '', LOCALE_COOKIE_NAME);
  if (cookie) {
    const fromCookie = supportedLocale(cookie);
    if (fromCookie && cookie.trim().toLowerCase() === fromCookie) return fromCookie;
  }

  const accepted = (headers.get('accept-language') ?? '')
    .split(',')
    .map((entry, index) => {
      const [tag = '', ...params] = entry.split(';');
      const q = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number(q);
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.tag !== '' && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const entry of accepted) {
    const locale = supportedLocale(entry.tag);
    if (locale) return locale;
  }

  return defaultMailLocale;
};

/** The language a user's mails are written in: their profile's language, or
 * `fallback` when they have no profile or the lookup fails. Never fails — a
 * mail must not be lost to the locale lookup. */
export const userMailLocale = (userId: string, fallback: MailLocale = defaultMailLocale) =>
  UserProfileRepo.pipe(
    Effect.flatMap((repo) => repo.findByUserId(userId)),
    Effect.map((profile) => toMailLocale(profile.language)),
    Effect.orElseSucceed(() => fallback)
  );

/** As `userMailLocale`, for a recipient known only by email (the magic
 * link): an existing user's profile language, else `fallback`. */
export const emailMailLocale = (email: string, fallback: MailLocale = defaultMailLocale) =>
  UserRepo.pipe(
    Effect.flatMap((repo) => repo.findByEmail(email)),
    Effect.flatMap((user) => userMailLocale(user.id, fallback)),
    Effect.orElseSucceed(() => fallback)
  );
