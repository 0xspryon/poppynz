-- Tier 3, step 4 (spec 2026-10-28 §15; umbrella §9): card disputes
-- (chargebacks). One row per provider dispute, the sessions its charge paid
-- for with the disputed amount attributed across them, and every evidence
-- submission. Poppynz bears the debit and the fee (ledger); a lost dispute
-- an admin allocates to the helper is recovered from their future transfers.
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'dispute_withdrawn';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'dispute_reinstated';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'dispute_fee';--> statement-breakpoint
ALTER TYPE "app_db"."contract_billing_suspension" ADD VALUE IF NOT EXISTS 'admin_review';--> statement-breakpoint
CREATE TYPE "app_db"."card_dispute_triage" AS ENUM('needs_response', 'evidence_submitted', 'allocation_needed', 'resolved');--> statement-breakpoint
CREATE TABLE "app_db"."card_disputes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"payment_reference" text,
	"charge_reference" text,
	"family_user_id" text NOT NULL,
	"contract_id" uuid,
	"cycle_id" uuid,
	"scope" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"evidence_due_by" timestamp,
	"charge_refundable" boolean DEFAULT false NOT NULL,
	"has_evidence" boolean DEFAULT false NOT NULL,
	"evidence_submission_count" integer DEFAULT 0 NOT NULL,
	"withdrawn_cents" integer DEFAULT 0 NOT NULL,
	"reinstated_cents" integer DEFAULT 0 NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"triage" "app_db"."card_dispute_triage" DEFAULT 'needs_response' NOT NULL,
	"evidence_summary" text,
	"evidence_summary_by_user_id" text,
	"evidence_summary_at" timestamp,
	"closed_at" timestamp,
	"provider_created_at" timestamp NOT NULL,
	"synced_at" timestamp NOT NULL,
	"notices_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_disputes_scope_check" CHECK ("card_disputes"."scope" in ('cycle', 'extra_session', 'payment')),
	CONSTRAINT "card_disputes_amounts_check" CHECK ("card_disputes"."amount_cents" >= 0 and "card_disputes"."withdrawn_cents" >= 0 and "card_disputes"."reinstated_cents" >= 0)
);--> statement-breakpoint
CREATE TABLE "app_db"."card_dispute_sessions" (
	"dispute_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"family_total_cents" integer NOT NULL,
	"helper_share_cents" integer NOT NULL,
	"disputed_cents" integer NOT NULL,
	"allocation" text,
	"allocation_reason" text,
	"helper_forfeit_cents" integer DEFAULT 0 NOT NULL,
	"recovery_id" uuid,
	"allocated_by_user_id" text,
	"allocated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_dispute_sessions_dispute_id_session_id_pk" PRIMARY KEY("dispute_id","session_id"),
	CONSTRAINT "card_dispute_sessions_amounts_check" CHECK ("card_dispute_sessions"."disputed_cents" >= 0 and "card_dispute_sessions"."disputed_cents" <= "card_dispute_sessions"."family_total_cents" and "card_dispute_sessions"."helper_forfeit_cents" >= 0 and "card_dispute_sessions"."helper_forfeit_cents" <= "card_dispute_sessions"."helper_share_cents"),
	CONSTRAINT "card_dispute_sessions_allocation_check" CHECK (("card_dispute_sessions"."allocation" is null and "card_dispute_sessions"."helper_forfeit_cents" = 0)
        or ("card_dispute_sessions"."allocation" = 'poppynz_absorbs' and "card_dispute_sessions"."helper_forfeit_cents" = 0 and "card_dispute_sessions"."allocated_by_user_id" is not null)
        or ("card_dispute_sessions"."allocation" = 'helper_not_provided' and "card_dispute_sessions"."allocation_reason" is not null and "card_dispute_sessions"."allocated_by_user_id" is not null))
);--> statement-breakpoint
CREATE TABLE "app_db"."card_dispute_evidence_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"submitted_by_user_id" text NOT NULL,
	"submitted_at" timestamp NOT NULL,
	"summary" text NOT NULL,
	"fields" jsonb NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."helper_recoveries" ADD COLUMN "card_dispute_id" uuid;--> statement-breakpoint
ALTER TABLE "app_db"."card_disputes" ADD CONSTRAINT "card_disputes_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app_db"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."card_disputes" ADD CONSTRAINT "card_disputes_family_user_id_user_id_fk" FOREIGN KEY ("family_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."card_disputes" ADD CONSTRAINT "card_disputes_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."card_disputes" ADD CONSTRAINT "card_disputes_cycle_id_contract_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app_db"."contract_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."card_disputes" ADD CONSTRAINT "card_disputes_evidence_summary_by_user_id_user_id_fk" FOREIGN KEY ("evidence_summary_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."card_dispute_sessions" ADD CONSTRAINT "card_dispute_sessions_dispute_id_card_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "app_db"."card_disputes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."card_dispute_sessions" ADD CONSTRAINT "card_dispute_sessions_session_id_contract_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app_db"."contract_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."card_dispute_sessions" ADD CONSTRAINT "card_dispute_sessions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."card_dispute_sessions" ADD CONSTRAINT "card_dispute_sessions_cycle_id_contract_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app_db"."contract_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."card_dispute_sessions" ADD CONSTRAINT "card_dispute_sessions_recovery_id_helper_recoveries_id_fk" FOREIGN KEY ("recovery_id") REFERENCES "app_db"."helper_recoveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."card_dispute_sessions" ADD CONSTRAINT "card_dispute_sessions_allocated_by_user_id_user_id_fk" FOREIGN KEY ("allocated_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."card_dispute_evidence_submissions" ADD CONSTRAINT "card_dispute_evidence_submissions_dispute_id_card_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "app_db"."card_disputes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."card_dispute_evidence_submissions" ADD CONSTRAINT "card_dispute_evidence_submissions_submitted_by_user_id_user_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."helper_recoveries" ADD CONSTRAINT "helper_recoveries_card_dispute_id_card_disputes_id_fk" FOREIGN KEY ("card_dispute_id") REFERENCES "app_db"."card_disputes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_disputes_provider_reference_uidx" ON "app_db"."card_disputes" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE INDEX "card_disputes_payment_id_idx" ON "app_db"."card_disputes" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "card_disputes_family_user_id_idx" ON "app_db"."card_disputes" USING btree ("family_user_id");--> statement-breakpoint
CREATE INDEX "card_disputes_triage_idx" ON "app_db"."card_disputes" USING btree ("triage");--> statement-breakpoint
CREATE INDEX "card_dispute_sessions_session_id_idx" ON "app_db"."card_dispute_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "card_dispute_evidence_submissions_dispute_idx" ON "app_db"."card_dispute_evidence_submissions" USING btree ("dispute_id");--> statement-breakpoint
-- What was sent to the bank is evidence: refuse every UPDATE and DELETE.
CREATE FUNCTION "app_db"."card_dispute_evidence_submissions_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'card_dispute_evidence_submissions is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "card_dispute_evidence_submissions_no_change" BEFORE UPDATE OR DELETE ON "app_db"."card_dispute_evidence_submissions" FOR EACH ROW EXECUTE FUNCTION "app_db"."card_dispute_evidence_submissions_append_only"();--> statement-breakpoint
-- An allocation is decided once: it can't be changed or undone afterwards
-- (a recovery may already be deducted from the helper's transfers).
CREATE FUNCTION "app_db"."card_dispute_sessions_allocation_final"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD.allocation IS NOT NULL AND (NEW.allocation IS DISTINCT FROM OLD.allocation OR NEW.helper_forfeit_cents <> OLD.helper_forfeit_cents OR NEW.recovery_id IS DISTINCT FROM OLD.recovery_id) THEN
		RAISE EXCEPTION 'card_dispute_sessions: session % of dispute % is already allocated', OLD.session_id, OLD.dispute_id
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "card_dispute_sessions_allocation_final" BEFORE UPDATE ON "app_db"."card_dispute_sessions" FOR EACH ROW EXECUTE FUNCTION "app_db"."card_dispute_sessions_allocation_final"();
