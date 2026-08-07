import { describe, expect, it } from 'vitest';
import { hasMalformedCallbackParam } from './magic-link-guard';

const fromRecord = (params: Record<string, string>) => (key: string) => params[key];

describe('hasMalformedCallbackParam', () => {
  it('accepts fully decoded callback urls', () => {
    expect(
      hasMalformedCallbackParam(
        fromRecord({
          callbackURL: 'http://localhost:5173/',
          errorCallbackURL: 'http://localhost:5173/auth/sign-in/error'
        })
      )
    ).toBe(false);
  });

  it('accepts missing params', () => {
    expect(hasMalformedCallbackParam(fromRecord({}))).toBe(false);
  });

  it('flags a percent escape truncated mid-sequence', () => {
    expect(hasMalformedCallbackParam(fromRecord({ callbackURL: 'http://localhost:5175%2' }))).toBe(
      true
    );
  });

  it('flags a mangled newUserCallbackURL even when others are fine', () => {
    expect(
      hasMalformedCallbackParam(
        fromRecord({
          callbackURL: 'http://localhost:5173/',
          newUserCallbackURL: 'http://localhost:5173/onboarding%G1'
        })
      )
    ).toBe(true);
  });
});
