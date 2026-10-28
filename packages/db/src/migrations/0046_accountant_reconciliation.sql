-- Tier 3, step 5 (spec 2026-10-28 §1 step 5, §13.2–13.4, §16): accountant
-- reimbursements and reconciliation with the payment provider.
--
-- 1. A refund settled outside Stripe ("marked handled") counts as refunded
--    for tax in the month it was marked: when that was, kept on the row.
ALTER TABLE "app_db"."session_refunds" ADD COLUMN "handled_at" timestamp;--> statement-breakpoint
-- Refunds already marked handled take the moment of their audit event (the
-- row's last change when, unexpectedly, there is none).
UPDATE "app_db"."session_refunds" AS r
SET "handled_at" = COALESCE(
	(SELECT max(e."created_at") FROM "app_db"."billing_audit_events" AS e
	 WHERE e."entity" = 'session_refund' AND e."entity_id" = r."id"::text AND e."action" = 'handled'),
	r."updated_at")
WHERE r."status" = 'cancelled' AND r."resolved_by_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "app_db"."session_refunds" ADD CONSTRAINT "session_refunds_handled_check" CHECK ("session_refunds"."handled_at" is null or ("session_refunds"."status" = 'cancelled' and "session_refunds"."resolved_by_user_id" is not null));--> statement-breakpoint
-- 2. "Paid to the bank": the helper payout a transfer went out in, and
--    whether that is known exactly (the payout's own balance transactions) or
--    approximated (sent before an automatic payout was created, §13.4).
ALTER TABLE "app_db"."helper_transfers" ADD COLUMN "payout_reference" text;--> statement-breakpoint
ALTER TABLE "app_db"."helper_transfers" ADD COLUMN "payout_match" text;--> statement-breakpoint
ALTER TABLE "app_db"."helper_transfers" ADD CONSTRAINT "helper_transfers_payout_match_check" CHECK ("helper_transfers"."payout_match" is null or "helper_transfers"."payout_match" in ('exact', 'approximate'));--> statement-breakpoint
-- Transfers already marked paid were matched the approximate way.
UPDATE "app_db"."helper_transfers" SET "payout_match" = 'approximate' WHERE "status" = 'paid';--> statement-breakpoint
-- 3. Reconciliation runs (the worker's daily one, or on demand) and the
--    provider's balance transactions they imported, each matched (or not)
--    to what Poppynz recorded.
CREATE TABLE "app_db"."reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"trigger" text NOT NULL,
	"requested_by_user_id" text,
	"period_from" timestamp NOT NULL,
	"period_to" timestamp NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"unmatched_count" integer DEFAULT 0 NOT NULL,
	"payouts_exact_count" integer DEFAULT 0 NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_runs_trigger_check" CHECK ("reconciliation_runs"."trigger" in ('schedule', 'manual')),
	CONSTRAINT "reconciliation_runs_status_check" CHECK ("reconciliation_runs"."status" in ('running', 'succeeded', 'incomplete', 'failed')),
	CONSTRAINT "reconciliation_runs_period_check" CHECK ("reconciliation_runs"."period_to" > "reconciliation_runs"."period_from")
);--> statement-breakpoint
CREATE TABLE "app_db"."provider_balance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"account" text,
	"type" text NOT NULL,
	"reporting_category" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"net_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"provider_created_at" timestamp NOT NULL,
	"available_on" timestamp NOT NULL,
	"description" text,
	"source_reference" text,
	"source_type" text,
	"payment_reference" text,
	"transfer_reference" text,
	"payout_reference" text,
	"fee_details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"match_kind" text,
	"matched_id" text,
	"match_note" text,
	"first_run_id" uuid NOT NULL,
	"last_run_id" uuid NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_balance_transactions_match_status_check" CHECK ("provider_balance_transactions"."match_status" in ('matched', 'unmatched', 'mismatch')),
	CONSTRAINT "provider_balance_transactions_net_check" CHECK ("provider_balance_transactions"."net_cents" = "provider_balance_transactions"."amount_cents" - "provider_balance_transactions"."fee_cents")
);--> statement-breakpoint
ALTER TABLE "app_db"."reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."provider_balance_transactions" ADD CONSTRAINT "provider_balance_transactions_first_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("first_run_id") REFERENCES "app_db"."reconciliation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."provider_balance_transactions" ADD CONSTRAINT "provider_balance_transactions_last_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "app_db"."reconciliation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_balance_transactions_reference_uidx" ON "app_db"."provider_balance_transactions" USING btree ("provider","reference");--> statement-breakpoint
CREATE INDEX "provider_balance_transactions_created_idx" ON "app_db"."provider_balance_transactions" USING btree ("provider_created_at");--> statement-breakpoint
CREATE INDEX "provider_balance_transactions_match_status_idx" ON "app_db"."provider_balance_transactions" USING btree ("match_status");--> statement-breakpoint
CREATE INDEX "provider_balance_transactions_source_idx" ON "app_db"."provider_balance_transactions" USING btree ("source_reference");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_started_at_idx" ON "app_db"."reconciliation_runs" USING btree ("started_at");--> statement-breakpoint
-- One run at a time: a second start while one is running is refused.
CREATE UNIQUE INDEX "reconciliation_runs_one_running_uidx" ON "app_db"."reconciliation_runs" USING btree ("provider") WHERE "reconciliation_runs"."status" = 'running';
