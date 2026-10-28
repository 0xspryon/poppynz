-- Tier 3, step 2 (spec 2026-10-28 §4.2–§4.4, §5, §7, §8): money effects of
-- session resolutions and session-based helper transfers.
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'session_refund_care';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'session_refund_fee';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'session_refund_fee_tax';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'cancellation_compensation';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'commission_reversal';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'commission_tax_reversal';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'transfer';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'transfer_held';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'transfer_reversal';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'helper_recovery';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'manual_payout';--> statement-breakpoint
ALTER TYPE "app_db"."billing_ledger_kind" ADD VALUE IF NOT EXISTS 'platform_absorbed';--> statement-breakpoint
CREATE TYPE "app_db"."session_refund_status" AS ENUM('pending', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "app_db"."helper_recovery_status" AS ENUM('outstanding', 'repaid', 'waived');--> statement-breakpoint
CREATE TYPE "app_db"."helper_transfer_status" AS ENUM('due', 'paused', 'sending', 'sent', 'paid', 'failed', 'settled', 'manual_review', 'manual_paid');--> statement-breakpoint
CREATE TYPE "app_db"."manual_payout_status" AS ENUM('pending_approval', 'approved', 'rejected');--> statement-breakpoint
-- A session cancelled late before its cycle's capture is charged its
-- compensation only; the cycle remembers which sessions its quote charged.
ALTER TABLE "app_db"."contract_sessions" ADD COLUMN "compensation_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_db"."contract_sessions" ADD CONSTRAINT "contract_sessions_compensation_check" CHECK ("contract_sessions"."compensation_cents" >= 0);--> statement-breakpoint
ALTER TABLE "app_db"."contract_cycles" ADD COLUMN "compensation_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_db"."contract_cycles" ADD COLUMN "charged_sessions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE "app_db"."contract_session_charges" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"cycle_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"basis" text NOT NULL,
	"care_cents" integer NOT NULL,
	"care_tax_lines" jsonb NOT NULL,
	"care_tax_cents" integer NOT NULL,
	"family_fee_cents" integer NOT NULL,
	"family_fee_tax_lines" jsonb NOT NULL,
	"family_fee_tax_cents" integer NOT NULL,
	"family_total_cents" integer NOT NULL,
	"commission_cents" integer NOT NULL,
	"commission_tax_lines" jsonb NOT NULL,
	"commission_tax_cents" integer NOT NULL,
	"helper_share_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_session_charges_basis_check" CHECK ("contract_session_charges"."basis" in ('session', 'compensation')),
	CONSTRAINT "contract_session_charges_family_total_check" CHECK ("contract_session_charges"."family_total_cents" = "contract_session_charges"."care_cents" + "contract_session_charges"."care_tax_cents" + "contract_session_charges"."family_fee_cents" + "contract_session_charges"."family_fee_tax_cents"),
	CONSTRAINT "contract_session_charges_helper_share_check" CHECK ("contract_session_charges"."helper_share_cents" = "contract_session_charges"."care_cents" + "contract_session_charges"."care_tax_cents" - "contract_session_charges"."commission_cents" - "contract_session_charges"."commission_tax_cents"),
	CONSTRAINT "contract_session_charges_amounts_check" CHECK ("contract_session_charges"."care_cents" >= 0 and "contract_session_charges"."family_fee_cents" >= 0 and "contract_session_charges"."commission_cents" >= 0)
);--> statement-breakpoint
CREATE TABLE "app_db"."session_refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"refund_key" text NOT NULL,
	"session_id" uuid NOT NULL,
	"resolution_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"care_cents" integer NOT NULL,
	"care_tax_lines" jsonb NOT NULL,
	"care_tax_cents" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"fee_tax_lines" jsonb NOT NULL,
	"fee_tax_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"commission_cents" integer DEFAULT 0 NOT NULL,
	"commission_tax_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "app_db"."session_refund_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_reference" text,
	"failure_reason" text,
	"notices_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refunded_at" timestamp,
	"resolved_by_user_id" text,
	"resolved_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_refunds_total_check" CHECK ("session_refunds"."total_cents" > 0 and "session_refunds"."total_cents" = "session_refunds"."care_cents" + "session_refunds"."care_tax_cents" + "session_refunds"."fee_cents" + "session_refunds"."fee_tax_cents"),
	CONSTRAINT "session_refunds_amounts_check" CHECK ("session_refunds"."care_cents" >= 0 and "session_refunds"."fee_cents" >= 0 and "session_refunds"."commission_cents" >= 0)
);--> statement-breakpoint
CREATE TABLE "app_db"."helper_recoveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"recovery_key" text NOT NULL,
	"helper_user_id" text NOT NULL,
	"contract_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"resolution_id" uuid,
	"amount_cents" integer NOT NULL,
	"recovered_cents" integer DEFAULT 0 NOT NULL,
	"status" "app_db"."helper_recovery_status" DEFAULT 'outstanding' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "helper_recoveries_amounts_check" CHECK ("helper_recoveries"."amount_cents" > 0 and "helper_recoveries"."recovered_cents" >= 0 and "helper_recoveries"."recovered_cents" <= "helper_recoveries"."amount_cents")
);--> statement-breakpoint
CREATE TABLE "app_db"."helper_transfers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"helper_user_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"status" "app_db"."helper_transfer_status" NOT NULL,
	"due_at" timestamp NOT NULL,
	"gross_cents" integer,
	"recovered_cents" integer,
	"amount_cents" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_reference" text,
	"source_reference" text,
	"failure_reason" text,
	"notices_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fixed_at" timestamp,
	"sent_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "helper_transfers_amount_check" CHECK ("helper_transfers"."amount_cents" is null or ("helper_transfers"."amount_cents" >= 0 and "helper_transfers"."amount_cents" = "helper_transfers"."gross_cents" - "helper_transfers"."recovered_cents"))
);--> statement-breakpoint
CREATE TABLE "app_db"."helper_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"session_id" uuid,
	"recovery_id" uuid,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "helper_transfer_items_kind_check" CHECK (("helper_transfer_items"."kind" = 'session' and "helper_transfer_items"."session_id" is not null and "helper_transfer_items"."amount_cents" >= 0)
        or ("helper_transfer_items"."kind" = 'held' and "helper_transfer_items"."session_id" is not null and "helper_transfer_items"."amount_cents" = 0)
        or ("helper_transfer_items"."kind" = 'recovery' and "helper_transfer_items"."recovery_id" is not null and "helper_transfer_items"."amount_cents" <= 0))
);--> statement-breakpoint
CREATE TABLE "app_db"."manual_payouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"helper_user_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" text NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"status" "app_db"."manual_payout_status" DEFAULT 'pending_approval' NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"recorded_at" timestamp NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "manual_payouts_amount_check" CHECK ("manual_payouts"."amount_cents" > 0),
	CONSTRAINT "manual_payouts_second_admin_check" CHECK ("manual_payouts"."decided_by_user_id" is null or "manual_payouts"."decided_by_user_id" <> "manual_payouts"."recorded_by_user_id")
);--> statement-breakpoint
CREATE TABLE "app_db"."session_money_effects" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"resolution_id" uuid,
	"contract_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"mechanism" text NOT NULL,
	"family_refund_cents" integer DEFAULT 0 NOT NULL,
	"helper_owed_cents" integer DEFAULT 0 NOT NULL,
	"signature" text NOT NULL,
	"applied_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "app_db"."billing_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text,
	"note" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."contract_session_charges" ADD CONSTRAINT "contract_session_charges_session_id_contract_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app_db"."contract_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_session_charges" ADD CONSTRAINT "contract_session_charges_cycle_id_contract_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app_db"."contract_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_session_charges" ADD CONSTRAINT "contract_session_charges_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_session_charges" ADD CONSTRAINT "contract_session_charges_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app_db"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_refunds" ADD CONSTRAINT "session_refunds_session_id_contract_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app_db"."contract_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_refunds" ADD CONSTRAINT "session_refunds_resolution_id_session_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "app_db"."session_resolutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_refunds" ADD CONSTRAINT "session_refunds_cycle_id_contract_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app_db"."contract_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_refunds" ADD CONSTRAINT "session_refunds_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_refunds" ADD CONSTRAINT "session_refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app_db"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_refunds" ADD CONSTRAINT "session_refunds_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."helper_recoveries" ADD CONSTRAINT "helper_recoveries_helper_user_id_user_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."helper_recoveries" ADD CONSTRAINT "helper_recoveries_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."helper_recoveries" ADD CONSTRAINT "helper_recoveries_session_id_contract_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app_db"."contract_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."helper_recoveries" ADD CONSTRAINT "helper_recoveries_resolution_id_session_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "app_db"."session_resolutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."helper_transfers" ADD CONSTRAINT "helper_transfers_cycle_id_contract_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app_db"."contract_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."helper_transfers" ADD CONSTRAINT "helper_transfers_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."helper_transfers" ADD CONSTRAINT "helper_transfers_helper_user_id_user_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."helper_transfer_items" ADD CONSTRAINT "helper_transfer_items_transfer_id_helper_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "app_db"."helper_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."helper_transfer_items" ADD CONSTRAINT "helper_transfer_items_session_id_contract_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app_db"."contract_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."helper_transfer_items" ADD CONSTRAINT "helper_transfer_items_recovery_id_helper_recoveries_id_fk" FOREIGN KEY ("recovery_id") REFERENCES "app_db"."helper_recoveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."manual_payouts" ADD CONSTRAINT "manual_payouts_transfer_id_helper_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "app_db"."helper_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."manual_payouts" ADD CONSTRAINT "manual_payouts_helper_user_id_user_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."manual_payouts" ADD CONSTRAINT "manual_payouts_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."manual_payouts" ADD CONSTRAINT "manual_payouts_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_money_effects" ADD CONSTRAINT "session_money_effects_session_id_contract_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app_db"."contract_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_money_effects" ADD CONSTRAINT "session_money_effects_resolution_id_session_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "app_db"."session_resolutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_money_effects" ADD CONSTRAINT "session_money_effects_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_money_effects" ADD CONSTRAINT "session_money_effects_cycle_id_contract_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app_db"."contract_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."billing_audit_events" ADD CONSTRAINT "billing_audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_session_charges_cycle_id_idx" ON "app_db"."contract_session_charges" USING btree ("cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_refunds_refund_key_uidx" ON "app_db"."session_refunds" USING btree ("refund_key");--> statement-breakpoint
CREATE INDEX "session_refunds_session_id_idx" ON "app_db"."session_refunds" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_refunds_payment_id_idx" ON "app_db"."session_refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "session_refunds_status_idx" ON "app_db"."session_refunds" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "helper_recoveries_recovery_key_uidx" ON "app_db"."helper_recoveries" USING btree ("recovery_key");--> statement-breakpoint
CREATE INDEX "helper_recoveries_helper_status_idx" ON "app_db"."helper_recoveries" USING btree ("helper_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "helper_transfers_cycle_sequence_uidx" ON "app_db"."helper_transfers" USING btree ("cycle_id","sequence");--> statement-breakpoint
CREATE INDEX "helper_transfers_helper_idx" ON "app_db"."helper_transfers" USING btree ("helper_user_id");--> statement-breakpoint
CREATE INDEX "helper_transfers_status_idx" ON "app_db"."helper_transfers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "helper_transfers_provider_reference_uidx" ON "app_db"."helper_transfers" USING btree ("provider_reference") WHERE "helper_transfers"."provider_reference" is not null;--> statement-breakpoint
CREATE INDEX "helper_transfer_items_transfer_id_idx" ON "app_db"."helper_transfer_items" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "helper_transfer_items_session_id_idx" ON "app_db"."helper_transfer_items" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_payouts_transfer_live_uidx" ON "app_db"."manual_payouts" USING btree ("transfer_id") WHERE "manual_payouts"."status" <> 'rejected';--> statement-breakpoint
CREATE INDEX "billing_audit_events_entity_idx" ON "app_db"."billing_audit_events" USING btree ("entity","entity_id");--> statement-breakpoint
-- Refund limits (spec §4.3), enforced here as well as in code: the live
-- refunds of a session never exceed its frozen family total, and those of a
-- payment never exceed what it captured. The charge and payment rows are
-- locked, so concurrent refunds of one session or payment queue up.
CREATE FUNCTION "app_db"."session_refunds_within_limits"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	charged integer;
	captured integer;
	refunded bigint;
BEGIN
	IF NEW.status = 'cancelled' THEN
		RETURN NEW;
	END IF;
	-- The same refund applied twice (a retry, a race): the insert is a no-op
	-- (ON CONFLICT on refund_key), so it is not counted against the limits.
	-- Checked after the lock below would be too late for a racing insert,
	-- so the charge row is locked first.
	PERFORM 1 FROM "app_db"."contract_session_charges" WHERE session_id = NEW.session_id FOR UPDATE;
	IF TG_OP = 'INSERT' AND EXISTS (
		SELECT 1 FROM "app_db"."session_refunds" WHERE refund_key = NEW.refund_key
	) THEN
		RETURN NEW;
	END IF;
	SELECT family_total_cents INTO charged FROM "app_db"."contract_session_charges"
		WHERE session_id = NEW.session_id AND payment_id = NEW.payment_id FOR UPDATE;
	IF charged IS NULL THEN
		RAISE EXCEPTION 'session_refunds: session % has no frozen charge on payment %', NEW.session_id, NEW.payment_id
			USING ERRCODE = 'check_violation';
	END IF;
	SELECT coalesce(sum(total_cents), 0) INTO refunded FROM "app_db"."session_refunds"
		WHERE session_id = NEW.session_id AND status <> 'cancelled' AND id <> NEW.id;
	IF refunded + NEW.total_cents > charged THEN
		RAISE EXCEPTION 'session_refunds: refunds for session % would exceed its charge (% > %)', NEW.session_id, refunded + NEW.total_cents, charged
			USING ERRCODE = 'check_violation';
	END IF;
	SELECT captured_cents INTO captured FROM "app_db"."payments" WHERE id = NEW.payment_id FOR UPDATE;
	SELECT coalesce(sum(total_cents), 0) INTO refunded FROM "app_db"."session_refunds"
		WHERE payment_id = NEW.payment_id AND status <> 'cancelled' AND id <> NEW.id;
	IF captured IS NULL OR refunded + NEW.total_cents > captured THEN
		RAISE EXCEPTION 'session_refunds: refunds on payment % would exceed what it captured', NEW.payment_id
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "session_refunds_limits" BEFORE INSERT OR UPDATE OF "total_cents", "status", "session_id", "payment_id" ON "app_db"."session_refunds" FOR EACH ROW EXECUTE FUNCTION "app_db"."session_refunds_within_limits"();--> statement-breakpoint
-- A transfer settled manually can never go out through the provider again.
CREATE FUNCTION "app_db"."helper_transfers_manual_is_final"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD.status = 'manual_paid' AND NEW.status <> 'manual_paid' THEN
		RAISE EXCEPTION 'helper_transfers: % was paid manually and is final', OLD.id USING ERRCODE = 'check_violation';
	END IF;
	IF OLD.status = 'manual_paid' AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference THEN
		RAISE EXCEPTION 'helper_transfers: % was paid manually and is final', OLD.id USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "helper_transfers_manual_final" BEFORE UPDATE ON "app_db"."helper_transfers" FOR EACH ROW EXECUTE FUNCTION "app_db"."helper_transfers_manual_is_final"();--> statement-breakpoint
-- The money audit is evidence: refuse every UPDATE and DELETE.
CREATE FUNCTION "app_db"."billing_audit_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'billing_audit_events is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "billing_audit_events_no_change" BEFORE UPDATE OR DELETE ON "app_db"."billing_audit_events" FOR EACH ROW EXECUTE FUNCTION "app_db"."billing_audit_events_append_only"();
