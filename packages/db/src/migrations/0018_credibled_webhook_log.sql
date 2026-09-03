-- TEMPORARY — staging-only capture of raw Credibled webhook deliveries.
--
-- We cannot exercise a real background check outside Canada, so the first
-- genuine delivery will arrive in staging. This table records every request
-- that reaches the webhook endpoint EXACTLY as received — before the size
-- guard, before JSON parsing, before signature verification — so that a
-- rejected delivery leaves evidence instead of a bare 401 in the logs.
--
-- The raw body is kept as text, not jsonb: the Credibled HMAC covers the
-- payload re-serialised Python-style, so re-deriving a signature offline needs
-- the exact bytes, and jsonb would not preserve key order.
--
-- Signature enforcement is switched off for the duration of the staging run
-- (see the handler), so `signature_valid` records what the check WOULD have
-- decided without letting a misconfigured secret block a delivery. A null
-- there means no secret was configured to check against.
--
-- Payloads carry applicant PII. This table is not to reach production, and
-- should be dropped from staging once the deliveries have been reviewed:
--
--   DROP TABLE IF EXISTS "app_db"."credibled_webhook_log";
--
CREATE TABLE "app_db"."credibled_webhook_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"audience" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"query" text,
	"headers" jsonb NOT NULL,
	"source_ip" text,
	"body_bytes" integer,
	"raw_body" text,
	"signature_valid" boolean,
	"signature_note" text,
	"response_status" integer,
	"outcome" text
);
--> statement-breakpoint
CREATE INDEX "credibled_webhook_log_received_at_idx" ON "app_db"."credibled_webhook_log" USING btree ("received_at");
