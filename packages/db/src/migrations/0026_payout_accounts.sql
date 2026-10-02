-- Helper payout accounts (Stripe Connect Express), piece 2b.
--
-- One row per helper. Stripe hosts onboarding; Poppynz stores only the
-- connected account id and the last snapshot it RE-FETCHED from Stripe (never
-- a webhook payload). `status` is derived from the three flags by the API:
--   ready      details submitted, payouts enabled, transfers capability active
--   disabled   Stripe rejected the account (disabled_reason 'rejected.*')
--   restricted details submitted but not ready
--   onboarding otherwise
-- refreshed_at drives the read-time re-fetch (PAYOUTS_REFRESH_AFTER_MINUTES);
-- NULL means never fetched. user_id is restrict: a helper with a payout
-- account is never hard-deleted under it.
CREATE TYPE "app_db"."payout_account_status" AS ENUM('onboarding', 'ready', 'restricted', 'disabled');--> statement-breakpoint
CREATE TABLE "app_db"."payout_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"account_reference" text NOT NULL,
	"status" "app_db"."payout_account_status" DEFAULT 'onboarding' NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"transfers_active" boolean DEFAULT false NOT NULL,
	"requirements_due" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disabled_reason" text,
	"refreshed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."payout_accounts" ADD CONSTRAINT "payout_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- How an account.updated webhook finds its helper.
CREATE UNIQUE INDEX "payout_accounts_account_reference_uidx" ON "app_db"."payout_accounts" USING btree ("account_reference");
