import { createHmac, timingSafeEqual } from 'node:crypto';

// Credibled signs webhooks with HMAC-SHA256 over the PARSED payload
// re-serialised the way Python does it — `json.dumps(data, sort_keys=True)`,
// which sorts object keys and puts a space after every comma and colon.
//
// Things that follow that are easy to get wrong:
//
//   - Signing the raw request body fails. So does `JSON.stringify`, because it
//     emits `{"a":1}` where Python emits `{"a": 1}`.
//   - Because the signature covers a re-serialisation rather than the bytes on
//     the wire, it says nothing about whitespace or key order in the request
//     itself. It authenticates the *values*, which is what we act on.
//   - Python's default is `ensure_ascii=True`: every character outside
//     printable ASCII becomes `\uXXXX` (one escape per UTF-16 unit, so an
//     emoji is a surrogate pair and a decomposed "é" — e + U+0301 — is
//     `e\u0301`, never normalised). Whether Credibled kept that default is
//     unknown, and the published vector is pure ASCII, so verification accepts
//     a signature over EITHER encoding. Both are canonical serialisations of
//     the same values; neither weakens what is authenticated.
//
// Verified against Credibled's published test vector — see signature.test.ts.

export type CredibledCanonicalOptions = {
  /** Mirror Python's `ensure_ascii` flag. Defaults to true, Python's default. */
  ensureAscii?: boolean;
};

const shortEscapes: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t'
};

const unicodeEscape = (unit: number) => `\\u${unit.toString(16).padStart(4, '0')}`;

/**
 * Python's `json.encoder.py_encode_basestring(_ascii)`, unit for unit.
 *
 * With ensureAscii the escaped set is everything outside 0x20–0x7e (so DEL
 * and every non-ASCII unit, which JSON.stringify would leave raw); without it
 * only `"`, `\` and the C0 controls are escaped. Hex is lowercase in both.
 */
const encodeString = (value: string, ensureAscii: boolean): string => {
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]!;
    const short = shortEscapes[char];
    if (short !== undefined) {
      out += short;
      continue;
    }
    const unit = value.charCodeAt(i);
    const escape = ensureAscii ? unit < 0x20 || unit > 0x7e : unit < 0x20;
    out += escape ? unicodeEscape(unit) : char;
  }
  return `${out}"`;
};

const canonicalStringify = (value: unknown, ensureAscii: boolean): string => {
  if (typeof value === 'string') {
    return encodeString(value, ensureAscii);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry, ensureAscii)).join(', ')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${encodeString(key, ensureAscii)}: ${canonicalStringify(record[key], ensureAscii)}`
      );
    return `{${entries.join(', ')}}`;
  }
  return JSON.stringify(value);
};

export const credibledCanonicalPayload = (
  value: unknown,
  options: CredibledCanonicalOptions = {}
): string => canonicalStringify(value, options.ensureAscii ?? true);

export const credibledSignature = (
  payload: unknown,
  secret: string,
  options: CredibledCanonicalOptions = {}
): string =>
  createHmac('sha256', secret)
    .update(credibledCanonicalPayload(payload, options), 'utf8')
    .digest('hex');

const signatureEquals = (given: string, expected: string): boolean => {
  // Hex of a SHA-256 digest is always 64 chars; a length mismatch can be
  // rejected outright because the length itself is not a secret.
  if (given.length !== expected.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
};

/**
 * Constant-time signature check, accepting either `ensure_ascii` encoding.
 *
 * Credibled sends no timestamp header, so there is no replay window to
 * enforce here — a captured delivery stays valid forever as far as the
 * signature is concerned. Replay safety has to come from the handler applying
 * status transitions idempotently, never from this function.
 */
export const verifyCredibledSignature = (
  payload: unknown,
  headerSignature: string | null | undefined,
  secret: string
): boolean => {
  if (!headerSignature) {
    return false;
  }
  // Both are always computed so a mismatch costs the same time either way.
  const ascii = signatureEquals(headerSignature, credibledSignature(payload, secret));
  const raw = signatureEquals(
    headerSignature,
    credibledSignature(payload, secret, { ensureAscii: false })
  );
  return ascii || raw;
};
