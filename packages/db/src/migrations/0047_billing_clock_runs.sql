-- Staging UAT (docs/staging-uat.md): the audit of the admin billing
-- fast-forward. Each row is one "run up to here": who ran which contract's
-- billing as of which instant (and for which upcoming event), the billing
-- status before and after, and the outcome. At most one run per contract is
-- `running` at a time.
CREATE TABLE "app_db"."billing_clock_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"target_at" timestamp NOT NULL,
	"event_kind" text,
	"event_label" text,
	"status" text DEFAULT 'running' NOT NULL,
	"billing_status_before" text NOT NULL,
	"billing_status_after" text,
	"summary" jsonb,
	"error" text,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_clock_runs_status_check" CHECK ("billing_clock_runs"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "billing_clock_runs_target_check" CHECK ("billing_clock_runs"."target_at" > "billing_clock_runs"."started_at")
);--> statement-breakpoint
ALTER TABLE "app_db"."billing_clock_runs" ADD CONSTRAINT "billing_clock_runs_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."billing_clock_runs" ADD CONSTRAINT "billing_clock_runs_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_clock_runs_contract_idx" ON "app_db"."billing_clock_runs" USING btree ("contract_id","started_at");--> statement-breakpoint
CREATE INDEX "billing_clock_runs_started_at_idx" ON "app_db"."billing_clock_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_clock_runs_one_running_uidx" ON "app_db"."billing_clock_runs" USING btree ("contract_id") WHERE "billing_clock_runs"."status" = 'running';
