import { describe, expect, it } from 'vitest';
import { resolveUiOrigin, trustedUiOrigins } from './ui-origin';

// Assertions are relative to whatever TRUSTED_ORIGINS resolves to (env or the
// @repo/env defaults) so the tests don't encode a specific origin list.
const fallback = trustedUiOrigins[0];
const other = trustedUiOrigins[1] ?? trustedUiOrigins[0];

describe('resolveUiOrigin', () => {
  it('passes through a trusted Origin header', () => {
    const headers = new Headers({ origin: other });
    expect(resolveUiOrigin(headers)).toBe(other);
  });

  it('falls back to the Referer origin when Origin is absent', () => {
    const headers = new Headers({ referer: `${other}/auth/sign-in?foo=1` });
    expect(resolveUiOrigin(headers)).toBe(other);
  });

  it('rejects an untrusted origin in favor of the first trusted origin', () => {
    const headers = new Headers({ origin: 'https://evil.example.com' });
    expect(resolveUiOrigin(headers)).toBe(fallback);
  });

  it('defaults to the first trusted origin without Origin or Referer', () => {
    expect(resolveUiOrigin(new Headers())).toBe(fallback);
  });

  it('ignores a malformed Referer', () => {
    const headers = new Headers({ referer: 'not a url' });
    expect(resolveUiOrigin(headers)).toBe(fallback);
  });
});
