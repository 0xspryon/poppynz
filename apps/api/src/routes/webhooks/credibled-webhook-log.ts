import {
  insertCredibledWebhookLog,
  type CredibledWebhookLogId
} from '@repo/db';
import type { BaseAppEnv, HonoContext } from '@/api/app-env';

/**
 * TEMPORARY — staging capture of raw Credibled webhook deliveries.
 *
 * A real background check cannot be run outside Canada, so the first genuine
 * delivery lands in staging with nobody watching. Every request that reaches
 * the endpoint is written to `app_db.credibled_webhook_log` verbatim, so a
 * delivery that would once have been rejected before reaching the handler —
 * bad signature, unparseable body, wrong path — leaves something to read
 * afterwards instead of a one-line 401.
 *
 * This file only turns a Hono request into the plain record the writer in
 * `@repo/db` expects. Remove it, that writer and migration 0018 together.
 */

const headersOf = (c: HonoContext<BaseAppEnv>): Record<string, string> => {
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
};

/** First hop of the forwarded chain, falling back to whatever the proxy set. */
const sourceIpOf = (c: HonoContext<BaseAppEnv>): string | null => {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return c.req.header('x-real-ip') ?? c.req.header('cf-connecting-ip') ?? null;
};

/**
 * Records one inbound request. `rawBody` is null when the body was never read
 * — the oversized-payload guard deliberately refuses before buffering it, and
 * the headers alone still say who called and with what content-length.
 *
 * Returns the row id so the signature check and outcome can be stitched on
 * once known, or null if the insert failed, which makes those a no-op.
 */
export const logCredibledWebhookRequest = async (
  c: HonoContext<BaseAppEnv>,
  audience: string | null,
  rawBody: string | null
): Promise<CredibledWebhookLogId> => {
  const url = new URL(c.req.url);
  return insertCredibledWebhookLog({
    audience,
    method: c.req.method,
    path: url.pathname,
    query: url.search.length > 0 ? url.search : null,
    headers: headersOf(c),
    sourceIp: sourceIpOf(c),
    rawBody
  });
};

export {
  recordCredibledWebhookSignature,
  updateCredibledWebhookLogOutcome as recordCredibledWebhookOutcome
} from '@repo/db';
