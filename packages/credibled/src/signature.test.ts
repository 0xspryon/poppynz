import { describe, expect, it } from 'bun:test';
import {
  credibledCanonicalPayload,
  credibledSignature,
  verifyCredibledSignature
} from './signature';

// Published by Credibled as the reference implementation check. If this ever
// fails, every inbound webhook is being rejected (or worse, accepted) — treat
// it as a production incident, not a flaky test.
const vector = {
  payload: { test: 'test' },
  canonical: '{"test": "test"}',
  secret: 'dbf737da5fe6b3cee97607a76f05081b2ce7620bbe06a84753c1dc91e33c6d1b',
  signature: '28f505fc8b57d941272eaa982ee16855d056fe0e6c23072ef076a75fd5918fa2'
};

describe('credibled signature', () => {
  it('matches the published test vector', () => {
    expect(credibledCanonicalPayload(vector.payload)).toBe(vector.canonical);
    expect(credibledSignature(vector.payload, vector.secret)).toBe(vector.signature);
  });

  it('serialises the way Python does, not the way JSON.stringify does', () => {
    const payload = { b: [1, { z: null, a: true }], a: 'x' };
    // Sorted keys, space after every comma and colon.
    expect(credibledCanonicalPayload(payload)).toBe('{"a": "x", "b": [1, {"a": true, "z": null}]}');
    expect(credibledCanonicalPayload(payload)).not.toBe(JSON.stringify(payload));
  });

  it('is insensitive to key order in the received payload', () => {
    // The signature covers a re-serialisation, so two orderings of the same
    // object must verify identically.
    const a = { uuid: 'u1', application_status: 'Complete' };
    const b = { application_status: 'Complete', uuid: 'u1' };
    expect(credibledSignature(a, vector.secret)).toBe(credibledSignature(b, vector.secret));
  });

  it('accepts a correct signature', () => {
    expect(verifyCredibledSignature(vector.payload, vector.signature, vector.secret)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    expect(verifyCredibledSignature({ test: 'tampered' }, vector.signature, vector.secret)).toBe(
      false
    );
  });

  it('rejects a signature made with a different secret', () => {
    const forged = credibledSignature(vector.payload, 'a'.repeat(64));
    expect(verifyCredibledSignature(vector.payload, forged, vector.secret)).toBe(false);
  });

  it('rejects a missing, empty or wrong-length signature', () => {
    expect(verifyCredibledSignature(vector.payload, null, vector.secret)).toBe(false);
    expect(verifyCredibledSignature(vector.payload, undefined, vector.secret)).toBe(false);
    expect(verifyCredibledSignature(vector.payload, '', vector.secret)).toBe(false);
    expect(verifyCredibledSignature(vector.payload, 'deadbeef', vector.secret)).toBe(false);
  });

  it('rejects a signature that differs only in case', () => {
    expect(
      verifyCredibledSignature(vector.payload, vector.signature.toUpperCase(), vector.secret)
    ).toBe(false);
  });
});
