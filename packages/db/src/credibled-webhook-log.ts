import { sql } from 'drizzle-orm';
import { db } from './db';

/**
 * TEMPORARY — staging capture of raw Credibled webhook deliveries.
 *
 * Lives here rather than in `apps/api` only because `drizzle-orm` is a
 * dependency of this package; the caller owns everything to do with the
 * request itself and hands over a plain record.
 *
 * Deliberately raw SQL against the plain drizzle handle: the table is absent
 * from `schema.ts`, from the Effect layer graph and from `AppServices`, so
 * removing the whole thing is deleting this file, migration 0018 and the call
 * sites. Every failure is swallowed — logging must never change what the
 * webhook endpoint does.
 *
 * Delete once the staging run has been reviewed; the rows contain applicant
 * PII.
 */

export type CredibledWebhookLogEntry = {
  audience: string | null;
  method: string;
  path: string;
  query: string | null;
  headers: Record<string, string>;
  sourceIp: string | null;
  /** Null when the body was never read (the oversized-payload guard). */
  rawBody: string | null;
};

export type CredibledWebhookLogId = string | null;

export const insertCredibledWebhookLog = async (
  entry: CredibledWebhookLogEntry
): Promise<CredibledWebhookLogId> => {
  try {
    const result = await db.execute(sql`
      INSERT INTO "app_db"."credibled_webhook_log"
        ("audience", "method", "path", "query", "headers", "source_ip", "body_bytes", "raw_body")
      VALUES (
        ${entry.audience},
        ${entry.method},
        ${entry.path},
        ${entry.query},
        ${JSON.stringify(entry.headers)}::jsonb,
        ${entry.sourceIp},
        ${entry.rawBody === null ? null : Buffer.byteLength(entry.rawBody, 'utf8')},
        ${entry.rawBody}
      )
      RETURNING "id"
    `);
    const id = result.rows[0]?.id;
    return typeof id === 'string' ? id : null;
  } catch (error) {
    console.error('[credibled:webhook:log] failed to record request', error);
    return null;
  }
};

/**
 * Records what the signature check WOULD have decided while enforcement is
 * switched off for the staging run. `valid` is null when there was no secret
 * to check against — itself the misconfiguration worth knowing about.
 */
export const recordCredibledWebhookSignature = async (
  id: CredibledWebhookLogId,
  valid: boolean | null,
  note: string
): Promise<void> => {
  if (!id) return;
  try {
    await db.execute(sql`
      UPDATE "app_db"."credibled_webhook_log"
      SET "signature_valid" = ${valid}, "signature_note" = ${note}
      WHERE "id" = ${id}::uuid
    `);
  } catch (error) {
    console.error('[credibled:webhook:log] failed to record signature check', error);
  }
};

/**
 * Stitches the response status and the handler's reason onto an already
 * recorded request. Correlating "what they sent" with "what we did with it" is
 * the point of the table; without it the rows are just payloads.
 */
export const updateCredibledWebhookLogOutcome = async (
  id: CredibledWebhookLogId,
  responseStatus: number,
  outcome: string
): Promise<void> => {
  if (!id) return;
  try {
    await db.execute(sql`
      UPDATE "app_db"."credibled_webhook_log"
      SET "response_status" = ${responseStatus}, "outcome" = ${outcome}
      WHERE "id" = ${id}::uuid
    `);
  } catch (error) {
    console.error('[credibled:webhook:log] failed to record outcome', error);
  }
};
