-- Tier 3, step 3 (spec 2026-10-28 §1 step 3, §12 decisions 4 and 5): extra
-- sessions. Either side proposes one; the other confirms (the family always
-- with an explicit "I authorise this charge"); silence lapses it. Once both
-- agreed it is a dated session (origin 'extra'), charged after a delay:
-- folded into its cycle's charge, or on its own payment.
ALTER TYPE "app_db"."payment_kind" ADD VALUE IF NOT EXISTS 'contract_extra_session';--> statement-breakpoint
CREATE TYPE "app_db"."contract_session_origin" AS ENUM('scheduled', 'extra');--> statement-breakpoint
CREATE TYPE "app_db"."extra_session_status" AS ENUM('proposed', 'withdrawn', 'declined', 'lapsed', 'agreed', 'cancelled', 'in_cycle', 'charging', 'charge_failed', 'charged');--> statement-breakpoint
ALTER TABLE "app_db"."contract_sessions" ADD COLUMN "origin" "app_db"."contract_session_origin" DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_db"."contract_sessions" ADD COLUMN "charge_route" text DEFAULT 'cycle' NOT NULL;--> statement-breakpoint
-- Cycle quotes charge only 'cycle' sessions: an extra session in its delay
-- ('pending') or charged on its own payment ('separate') is never in them.
ALTER TABLE "app_db"."contract_sessions" ADD CONSTRAINT "contract_sessions_charge_route_check" CHECK ("contract_sessions"."charge_route" in ('cycle', 'pending', 'separate') and ("contract_sessions"."origin" = 'extra' or "contract_sessions"."charge_route" = 'cycle'));--> statement-breakpoint
CREATE TABLE "app_db"."contract_extra_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"proposed_by_user_id" text NOT NULL,
	"proposed_by_side" text NOT NULL,
	"date" date NOT NULL,
	"start_minutes" integer NOT NULL,
	"end_minutes" integer NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"elapsed_minutes" integer NOT NULL,
	"service_id" text NOT NULL,
	"service_name" text NOT NULL,
	"rate_cents" integer NOT NULL,
	"value_cents" integer NOT NULL,
	"quoted_total_cents" integer NOT NULL,
	"note" text,
	"status" "app_db"."extra_session_status" DEFAULT 'proposed' NOT NULL,
	"respond_by" timestamp NOT NULL,
	"responded_by_user_id" text,
	"responded_at" timestamp,
	"response_note" text,
	"family_authorised_at" timestamp,
	"family_authorised_cents" integer,
	"agreed_at" timestamp,
	"charge_at" timestamp,
	"cancelled_by_user_id" text,
	"cancelled_at" timestamp,
	"session_id" uuid,
	"cycle_id" uuid,
	"payment_id" uuid,
	"charge_attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"family_total_cents" integer,
	"tax_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"charged_at" timestamp,
	"last_error" text,
	"notices_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_extra_sessions_side_check" CHECK ("contract_extra_sessions"."proposed_by_side" in ('family', 'helper')),
	CONSTRAINT "contract_extra_sessions_times_check" CHECK ("contract_extra_sessions"."start_minutes" >= 0 and "contract_extra_sessions"."end_minutes" <= 1440 and "contract_extra_sessions"."end_minutes" > "contract_extra_sessions"."start_minutes" and "contract_extra_sessions"."value_cents" > 0 and "contract_extra_sessions"."quoted_total_cents" > 0),
	CONSTRAINT "contract_extra_sessions_authorised_check" CHECK ("contract_extra_sessions"."status" in ('proposed', 'withdrawn', 'declined', 'lapsed') or ("contract_extra_sessions"."family_authorised_at" is not null and "contract_extra_sessions"."agreed_at" is not null and "contract_extra_sessions"."charge_at" is not null and "contract_extra_sessions"."session_id" is not null))
);--> statement-breakpoint
CREATE TABLE "app_db"."contract_extra_session_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"extra_session_id" uuid NOT NULL,
	"actor_user_id" text,
	"actor_side" text NOT NULL,
	"action" text NOT NULL,
	"from_status" "app_db"."extra_session_status",
	"to_status" "app_db"."extra_session_status" NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_extra_session_events_actor_side_check" CHECK ("contract_extra_session_events"."actor_side" in ('family', 'helper', 'admin', 'system'))
);--> statement-breakpoint
ALTER TABLE "app_db"."contract_extra_sessions" ADD CONSTRAINT "contract_extra_sessions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_extra_sessions" ADD CONSTRAINT "contract_extra_sessions_proposed_by_user_id_user_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_extra_sessions" ADD CONSTRAINT "contract_extra_sessions_responded_by_user_id_user_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_extra_sessions" ADD CONSTRAINT "contract_extra_sessions_cancelled_by_user_id_user_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_extra_sessions" ADD CONSTRAINT "contract_extra_sessions_session_id_contract_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app_db"."contract_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_extra_sessions" ADD CONSTRAINT "contract_extra_sessions_cycle_id_contract_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app_db"."contract_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_extra_sessions" ADD CONSTRAINT "contract_extra_sessions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app_db"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_extra_session_events" ADD CONSTRAINT "contract_extra_session_events_extra_session_id_contract_extra_sessions_id_fk" FOREIGN KEY ("extra_session_id") REFERENCES "app_db"."contract_extra_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_extra_session_events" ADD CONSTRAINT "contract_extra_session_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_extra_sessions_contract_id_idx" ON "app_db"."contract_extra_sessions" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_extra_sessions_status_idx" ON "app_db"."contract_extra_sessions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_extra_sessions_session_id_uidx" ON "app_db"."contract_extra_sessions" USING btree ("session_id") WHERE "contract_extra_sessions"."session_id" is not null;--> statement-breakpoint
-- One active proposal per slot (the overlap trigger below refuses the rest).
CREATE UNIQUE INDEX "contract_extra_sessions_proposal_slot_uidx" ON "app_db"."contract_extra_sessions" USING btree ("contract_id","date","start_minutes") WHERE "contract_extra_sessions"."status" = 'proposed';--> statement-breakpoint
CREATE INDEX "contract_extra_session_events_extra_session_id_idx" ON "app_db"."contract_extra_session_events" USING btree ("extra_session_id");--> statement-breakpoint
-- No overlapping active sessions per contract: a proposed or agreed extra
-- session may not overlap another open proposal, nor any session of the
-- contract that isn't cancelled (scheduled sessions may overlap each other —
-- that stays legal, the provider judges). Serialised per contract.
CREATE FUNCTION "app_db"."contract_extra_sessions_no_overlap"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.status NOT IN ('proposed', 'agreed') THEN
		RETURN NEW;
	END IF;
	IF TG_OP = 'UPDATE' AND OLD.status = NEW.status AND OLD.starts_at = NEW.starts_at AND OLD.ends_at = NEW.ends_at THEN
		RETURN NEW;
	END IF;
	PERFORM pg_advisory_xact_lock(hashtextextended('contract_extra_sessions:' || NEW.contract_id::text, 0));
	IF EXISTS (
		SELECT 1 FROM "app_db"."contract_extra_sessions" other
		WHERE other.contract_id = NEW.contract_id
			AND other.id <> NEW.id
			AND other.status = 'proposed'
			AND other.starts_at < NEW.ends_at
			AND NEW.starts_at < other.ends_at
	) OR EXISTS (
		SELECT 1 FROM "app_db"."contract_sessions" s
		WHERE s.contract_id = NEW.contract_id
			AND s.status <> 'cancelled'
			AND s.id IS DISTINCT FROM NEW.session_id
			AND s.starts_at < NEW.ends_at
			AND NEW.starts_at < s.ends_at
	) THEN
		RAISE EXCEPTION 'extra_session_overlap: % overlaps another session of contract %', NEW.id, NEW.contract_id
			USING ERRCODE = 'exclusion_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "contract_extra_sessions_no_overlap" BEFORE INSERT OR UPDATE OF "status", "starts_at", "ends_at" ON "app_db"."contract_extra_sessions" FOR EACH ROW EXECUTE FUNCTION "app_db"."contract_extra_sessions_no_overlap"();--> statement-breakpoint
-- The audit is evidence: refuse every UPDATE and DELETE.
CREATE FUNCTION "app_db"."contract_extra_session_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'contract_extra_session_events is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "contract_extra_session_events_no_change" BEFORE UPDATE OR DELETE ON "app_db"."contract_extra_session_events" FOR EACH ROW EXECUTE FUNCTION "app_db"."contract_extra_session_events_append_only"();
