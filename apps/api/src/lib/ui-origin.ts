import { trustedOriginsConfig } from '@repo/env';
import { Effect } from 'effect';

export const trustedUiOrigins: ReadonlyArray<string> = Effect.runSync(trustedOriginsConfig)
  .trustedOrigins.split(';')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter((origin) => origin.length > 0);

if (trustedUiOrigins.length === 0) {
  throw new Error('TRUSTED_ORIGINS must contain at least one origin');
}

const safeOrigin = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * The UI origin magic-link callbacks should return to: the calling app's
 * Origin (or Referer) when it is trusted, else the first trusted origin.
 */
export const resolveUiOrigin = (headers: Headers): string => {
  const referer = headers.get('referer');
  const origin = headers.get('origin') ?? (referer ? safeOrigin(referer) : null);
  return origin && trustedUiOrigins.includes(origin) ? origin : trustedUiOrigins[0];
};
