import { createHmac, timingSafeEqual } from 'node:crypto';

// Credibled signs webhooks with HMAC-SHA256 over the PARSED payload
// re-serialised the way Python does it — `json.dumps(data, sort_keys=True)`,
// which sorts object keys and puts a space after every comma and colon.
//
// Two things follow that are easy to get wrong:
//
//   - Signing the raw request body fails. So does `JSON.stringify`, because it
//     emits `{"a":1}` where Python emits `{"a": 1}`.
//   - Because the signature covers a re-serialisation rather than the bytes on
//     the wire, it says nothing about whitespace or key order in the request
//     itself. It authenticates the *values*, which is what we act on.
//
// Verified against Credibled's published test vector — see signature.test.ts.

const canonicalStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(', ')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}: ${canonicalStringify(record[key])}`);
    return `{${entries.join(', ')}}`;
  }
  return JSON.stringify(value);
};

export const credibledCanonicalPayload = canonicalStringify;

export const credibledSignature = (payload: unknown, secret: string): string =>
  createHmac('sha256', secret).update(canonicalStringify(payload), 'utf8').digest('hex');

/**
 * Constant-time signature check.
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

  const expected = credibledSignature(payload, secret);
  // Hex of a SHA-256 digest is always 64 chars; a length mismatch can be
  // rejected outright because the length itself is not a secret.
  if (headerSignature.length !== expected.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(headerSignature, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
};
