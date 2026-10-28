-- Tier 3, step 1 (spec 2026-10-28 §4.1): what happened to one dated session.
-- Records only: nothing here changes what billing holds, charges or pays,
-- and contract_sessions.status is left alone (step 2 applies the money).
CREATE TYPE "app_db"."session_resolution_kind" AS ENUM('family_cancelled_early', 'family_cancelled_late', 'family_no_show', 'family_reduced_hours', 'helper_cancelled', 'helper_no_show', 'day_off_agreed', 'disputed');--> statement-breakpoint
CREATE TYPE "app_db"."session_resolution_status" AS ENUM('proposed', 'confirmed', 'contested', 'decided', 'lapsed', 'reversed');--> statement-breakpoint
CREATE TYPE "app_db"."session_resolution_side" AS ENUM('family', 'helper', 'admin');--> statement-breakpoint
CREATE TYPE "app_db"."session_resolution_response" AS ENUM('accepted', 'contested', 'declined');--> statement-breakpoint
CREATE TYPE "app_db"."session_resolution_decision" AS ENUM('family_cancelled_early', 'family_cancelled_late', 'family_no_show', 'family_reduced_hours', 'helper_cancelled', 'helper_no_show', 'day_off_agreed', 'as_scheduled');--> statement-breakpoint
CREATE TABLE "app_db"."session_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"kind" "app_db"."session_resolution_kind" NOT NULL,
	"reported_by_user_id" text NOT NULL,
	"reported_by_side" "app_db"."session_resolution_side" NOT NULL,
	"recorded_at" timestamp NOT NULL,
	"reason" text,
	"note" text,
	"minutes_worked" integer,
	"status" "app_db"."session_resolution_status" NOT NULL,
	"respond_by" timestamp,
	"responded_by_user_id" text,
	"responded_at" timestamp,
	"response" "app_db"."session_resolution_response",
	"response_note" text,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"decision" "app_db"."session_resolution_decision",
	"decision_minutes_worked" integer,
	"decision_reason" text,
	"policy_version_id" uuid,
	"policy_version" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_resolutions_minutes_worked_check" CHECK ("session_resolutions"."minutes_worked" is null or "session_resolutions"."minutes_worked" >= 0),
	CONSTRAINT "session_resolutions_decision_minutes_check" CHECK ("session_resolutions"."decision_minutes_worked" is null or "session_resolutions"."decision_minutes_worked" >= 0)
);--> statement-breakpoint
CREATE TABLE "app_db"."session_resolution_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"resolution_id" uuid NOT NULL,
	"actor_user_id" text,
	"actor_side" text NOT NULL,
	"action" text NOT NULL,
	"from_status" "app_db"."session_resolution_status",
	"to_status" "app_db"."session_resolution_status" NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_resolution_events_actor_side_check" CHECK ("session_resolution_events"."actor_side" in ('family', 'helper', 'admin', 'system'))
);--> statement-breakpoint
ALTER TABLE "app_db"."session_resolutions" ADD CONSTRAINT "session_resolutions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_resolutions" ADD CONSTRAINT "session_resolutions_session_id_contract_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app_db"."contract_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_resolutions" ADD CONSTRAINT "session_resolutions_cycle_id_contract_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "app_db"."contract_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_resolutions" ADD CONSTRAINT "session_resolutions_reported_by_user_id_user_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_resolutions" ADD CONSTRAINT "session_resolutions_responded_by_user_id_user_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_resolutions" ADD CONSTRAINT "session_resolutions_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_resolutions" ADD CONSTRAINT "session_resolutions_policy_version_id_tc_document_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "app_db"."tc_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_resolution_events" ADD CONSTRAINT "session_resolution_events_resolution_id_session_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "app_db"."session_resolutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."session_resolution_events" ADD CONSTRAINT "session_resolution_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- One active resolution per session; a lapsed day-off proposal or a reversed
-- resolution is history and frees the session.
CREATE UNIQUE INDEX "session_resolutions_session_active_uidx" ON "app_db"."session_resolutions" USING btree ("session_id") WHERE "session_resolutions"."status" not in ('reversed', 'lapsed');--> statement-breakpoint
CREATE INDEX "session_resolutions_contract_id_idx" ON "app_db"."session_resolutions" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "session_resolutions_status_respond_by_idx" ON "app_db"."session_resolutions" USING btree ("status","respond_by");--> statement-breakpoint
CREATE INDEX "session_resolution_events_resolution_id_idx" ON "app_db"."session_resolution_events" USING btree ("resolution_id");--> statement-breakpoint
-- The audit is evidence: refuse every UPDATE and DELETE.
CREATE FUNCTION "app_db"."session_resolution_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'session_resolution_events is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "session_resolution_events_no_change" BEFORE UPDATE OR DELETE ON "app_db"."session_resolution_events" FOR EACH ROW EXECUTE FUNCTION "app_db"."session_resolution_events_append_only"();
