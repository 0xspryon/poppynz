import { describe, expect, it } from 'bun:test';
import { pickPswDocumentType } from './0005_uat_catalogue_and_screening';

const type = (id: string, name: string) => ({ id, name });

describe('0005 PSW document type lookup', () => {
  it('prefers the seeded name', () => {
    expect(
      pickPswDocumentType([
        type('a', 'PSW certificate'),
        type('b', 'Personal Support Worker (PSW)')
      ])?.id
    ).toBe('b');
  });

  it('falls back to a case- and space-insensitive match', () => {
    expect(pickPswDocumentType([type('a', ' personal support  worker (psw) ')])?.id).toBe('a');
  });

  it('accepts a single type renamed by hand', () => {
    expect(
      pickPswDocumentType([type('a', 'First Aid Certification'), type('b', 'PSW Certificate')])
        ?.id
    ).toBe('b');
  });

  it('returns null rather than guessing when none or several match', () => {
    expect(pickPswDocumentType([type('a', 'First Aid Certification')])).toBeNull();
    expect(pickPswDocumentType([])).toBeNull();
    expect(pickPswDocumentType([type('a', 'PSW Certificate'), type('b', 'PSW diploma')])).toBeNull();
  });
});
