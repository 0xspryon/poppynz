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

  // Expected strings below were produced by CPython's json.dumps(sort_keys=True)
  // with ensure_ascii left at its default (True) and set to False.
  describe('non-ASCII, the way json.dumps does it', () => {
    it('escapes a precomposed accent as one \\u escape by default', () => {
      const payload = { firstName: 'José' };
      expect(credibledCanonicalPayload(payload)).toBe('{"firstName": "Jos\\u00e9"}');
      expect(credibledCanonicalPayload(payload, { ensureAscii: false })).toBe(
        '{"firstName": "José"}'
      );
    });

    it('does not normalise a decomposed accent — the combining mark is its own escape', () => {
      // "é" typed as e + U+0301 looks identical but is two code points, and
      // json.dumps escapes each without folding them into U+00E9.
      const payload = { firstName: 'Jose\u0301' };
      expect(credibledCanonicalPayload(payload)).toBe('{"firstName": "Jose\\u0301"}');
      expect(credibledCanonicalPayload(payload, { ensureAscii: false })).toBe(
        '{"firstName": "Jose\u0301"}'
      );
      expect(credibledSignature(payload, vector.secret)).not.toBe(
        credibledSignature({ firstName: 'José' }, vector.secret)
      );
    });

    it('escapes an astral character as a surrogate pair', () => {
      expect(credibledCanonicalPayload({ note: 'ok 😀' })).toBe('{"note": "ok \\ud83d\\ude00"}');
      expect(credibledCanonicalPayload({ note: 'ok 😀' }, { ensureAscii: false })).toBe(
        '{"note": "ok 😀"}'
      );
    });

    it('escapes controls and DEL like Python, in both modes', () => {
      const payload = { s: 'a\tb\nc"d\\e\x01f\x7fg' };
      // DEL is outside printable ASCII, so ensure_ascii escapes it — but the
      // non-ASCII mode leaves it raw, exactly as py_encode_basestring does.
      expect(credibledCanonicalPayload(payload)).toBe(
        '{"s": "a\\tb\\nc\\"d\\\\e\\u0001f\\u007fg"}'
      );
      expect(credibledCanonicalPayload(payload, { ensureAscii: false })).toBe(
        '{"s": "a\\tb\\nc\\"d\\\\e\\u0001f\x7fg"}'
      );
    });

    it('escapes keys as well as values, at every depth', () => {
      const payload = { clé: ['ñ', { ß: 1.5 }] };
      expect(credibledCanonicalPayload(payload)).toBe(
        '{"cl\\u00e9": ["\\u00f1", {"\\u00df": 1.5}]}'
      );
      expect(credibledCanonicalPayload(payload, { ensureAscii: false })).toBe(
        '{"clé": ["ñ", {"ß": 1.5}]}'
      );
    });

    it('verifies a signature made over either encoding', () => {
      const payload = { firstName: 'José', uuid: 'u1' };
      const ascii = credibledSignature(payload, vector.secret);
      const raw = credibledSignature(payload, vector.secret, { ensureAscii: false });
      expect(ascii).not.toBe(raw);
      expect(verifyCredibledSignature(payload, ascii, vector.secret)).toBe(true);
      expect(verifyCredibledSignature(payload, raw, vector.secret)).toBe(true);
      // Accepting two encodings must not accept anything else.
      expect(verifyCredibledSignature({ ...payload, uuid: 'u2' }, ascii, vector.secret)).toBe(
        false
      );
      expect(verifyCredibledSignature({ ...payload, uuid: 'u2' }, raw, vector.secret)).toBe(false);
    });
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
