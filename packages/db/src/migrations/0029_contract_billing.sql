-- Contract billing (piece 3): one billing schedule per accepted contract, its
-- 3-day cycles, the dated sessions materialised on a rolling 14-day window,
-- a ledger entry for every amount, and incidents for system failures.
--
-- Every foreign key is restrict (umbrella §10). Idempotency lives in unique
-- keys: (contract, index) for cycles, (contract, date, slot) for sessions,
-- entry_key for the ledger, (cycle, kind) for incidents — so the worker can
-- rerun any step without duplicating anything.
CREATE TYPE "app_db"."contract_billing_status" AS ENUM('awaiting_payment_readiness', 'scheduled', 'active', 'suspended', 'cancelled', 'ended');--> statement-breakpoint
CREATE TYPE "app_db"."contract_billing_suspension" AS ENUM('card', 'helper_not_ready', 'provider_unavailable');--> statement-breakpoint
CREATE TYPE "app_db"."contract_cycle_status" AS ENUM('scheduled', 'authorising', 'authorised', 'grace', 'capturing', 'captured', 'suspended', 'capture_failed', 'cancelled', 'empty', 'carried');--> statement-breakpoint
CREATE TYPE "app_db"."contract_cycle_charge_mode" AS ENUM('hold', 'immediate', 'resume');--> statement-breakpoint
CREATE TYPE "app_db"."contract_session_status" AS ENUM('scheduled', 'completed', 'cancelled', 'disputed', 'suspended');--> statement-breakpoint
CREATE TYPE "app_db"."billing_ledger_kind" AS ENUM('session', 'service_tax', 'family_fee', 'family_fee_tax', 'provider_commission', 'provider_commission_tax', 'capture', 'carry_forward', 'carry_absorbed', 'hold_released');--> statement-breakpoint
CREATE TYPE "app_db"."billing_ledger_party" AS ENUM('family', 'provider', 'platform');--> statement-breakpoint
CREATE TABLE "app_db"."contract_billing" (
	"contract_id" uuid PRIMARY KEY NOT NULL,
	"accepted_version_id" uuid NOT NULL,
	"status" "app_db"."contract_billing_status" NOT NULL,
	"suspended_reason" "app_db"."contract_billing_suspension",
	"suspended_at" timestamp,
	"family_fee_bps" integer NOT NULL,
	"provider_commission_bps" integer NOT NULL,
	"family_province" text NOT NULL,
	"helper_province" text NOT NULL,
	"time_zone" text NOT NULL,
	"starts_on" date NOT NULL,
	"billable_from" timestamp,
	"materialised_through" date,
	"reminders_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cancelled_at" timestamp,
	"ended_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_billing_suspension_when_suspended" CHECK (("status" = 'suspended') = ("suspended_reason" IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE "app_db"."contract_cycles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"hold_at" timestamp NOT NULL,
	"capture_at" timestamp NOT NULL,
	"transfer_at" timestamp NOT NULL,
	"status" "app_db"."contract_cycle_status" DEFAULT 'scheduled' NOT NULL,
	"charge_mode" "app_db"."contract_cycle_charge_mode",
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"payment_id" uuid,
	"carried_in_cents" integer DEFAULT 0 NOT NULL,
	"service_cents" integer,
	"service_tax_cents" integer,
	"family_fee_bps" integer,
	"family_fee_cents" integer,
	"family_fee_tax_cents" integer,
	"family_total_cents" integer,
	"provider_commission_bps" integer,
	"provider_commission_cents" integer,
	"provider_commission_tax_cents" integer,
	"provider_share_cents" integer,
	"tax_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"carried_out_cents" integer DEFAULT 0 NOT NULL,
	"held_cents" integer,
	"captured_cents" integer,
	"funded_at" timestamp,
	"captured_at" timestamp,
	"suspended_at" timestamp,
	"resume_from" timestamp,
	"notices_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_cycles_dates_valid" CHECK ("ends_on" >= "starts_on")
);--> statement-breakpoint
CREATE TABLE "app_db"."contract_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot" text NOT NULL,
	"service_id" text NOT NULL,
	"service_name" text NOT NULL,
	"start_minutes" integer NOT NULL,
	"end_minutes" integer NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"elapsed_minutes" integer NOT NULL,
	"rate_cents" integer NOT NULL,
	"value_cents" integer NOT NULL,
	"status" "app_db"."contract_session_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "app_db"."billing_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"cycle_id" uuid,
	"session_id" uuid,
	"payment_id" uuid,
	"entry_key" text NOT NULL,
	"kind" "app_db"."billing_ledger_kind" NOT NULL,
	"party" "app_db"."billing_ledger_party" NOT NULL,
	"amount_cents" integer NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "app_db"."billing_incidents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"cycle_id" uuid,
	"kind" text NOT NULL,
	"detail" text NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."contract_billing" ADD CONSTRAINT "contract_billing_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_billing" ADD CONSTRAINT "contract_billing_accepted_version_id_contract_versions_id_fk" FOREIGN KEY ("accepted_version_id") REFERENCES "app_db"."contract_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_cycles" ADD CONSTRAINT "contract_cycles_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_cycles" ADD CONSTRAINT "contract_cycles_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app_db"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_sessions" ADD CONSTRAINT "contract_sessions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_sessions" ADD CONSTRAINT "contract_sessions_cycle_id_contract_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app_db"."contract_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_cycle_id_contract_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app_db"."contract_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_session_id_contract_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app_db"."contract_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app_db"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."billing_incidents" ADD CONSTRAINT "billing_incidents_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."billing_incidents" ADD CONSTRAINT "billing_incidents_cycle_id_contract_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app_db"."contract_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_billing_status_idx" ON "app_db"."contract_billing" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_cycles_contract_index_uidx" ON "app_db"."contract_cycles" USING btree ("contract_id","index");--> statement-breakpoint
CREATE INDEX "contract_cycles_status_idx" ON "app_db"."contract_cycles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contract_cycles_payment_id_idx" ON "app_db"."contract_cycles" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_sessions_contract_date_slot_uidx" ON "app_db"."contract_sessions" USING btree ("contract_id","date","slot");--> statement-breakpoint
CREATE INDEX "contract_sessions_cycle_id_idx" ON "app_db"."contract_sessions" USING btree ("cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_ledger_entries_entry_key_uidx" ON "app_db"."billing_ledger_entries" USING btree ("entry_key");--> statement-breakpoint
CREATE INDEX "billing_ledger_entries_contract_id_idx" ON "app_db"."billing_ledger_entries" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_incidents_cycle_kind_uidx" ON "app_db"."billing_incidents" USING btree ("cycle_id","kind");--> statement-breakpoint
CREATE INDEX "billing_incidents_contract_id_idx" ON "app_db"."billing_incidents" USING btree ("contract_id");--> statement-breakpoint
-- Umbrella §10: a contract's people are never hard-deleted from under it.
ALTER TABLE "app_db"."contracts" DROP CONSTRAINT "contracts_family_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "app_db"."contracts" ADD CONSTRAINT "contracts_family_user_id_user_id_fk" FOREIGN KEY ("family_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contracts" DROP CONSTRAINT "contracts_provider_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "app_db"."contracts" ADD CONSTRAINT "contracts_provider_user_id_user_id_fk" FOREIGN KEY ("provider_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;
