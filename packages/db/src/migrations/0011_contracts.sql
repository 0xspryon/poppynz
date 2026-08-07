CREATE TYPE "app_db"."contract_status" AS ENUM('draft', 'proposed', 'changes_requested', 'declined', 'active', 'ending', 'ended');--> statement-breakpoint
CREATE TYPE "app_db"."contract_version_status" AS ENUM('draft', 'proposed', 'changes_requested', 'accepted', 'declined', 'superseded', 'withdrawn');--> statement-breakpoint
CREATE TABLE "app_db"."contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"family_user_id" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"status" "app_db"."contract_status" DEFAULT 'draft' NOT NULL,
	"ends_on" date,
	"ended_by_user_id" text,
	"end_note" text,
	"end_noticed_at" timestamp,
	"family_seen_at" timestamp,
	"provider_seen_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."contracts" ADD CONSTRAINT "contracts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app_db"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contracts" ADD CONSTRAINT "contracts_family_user_id_user_id_fk" FOREIGN KEY ("family_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contracts" ADD CONSTRAINT "contracts_provider_user_id_user_id_fk" FOREIGN KEY ("provider_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contracts" ADD CONSTRAINT "contracts_ended_by_user_id_user_id_fk" FOREIGN KEY ("ended_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_conversation_uidx" ON "app_db"."contracts" USING btree ("conversation_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "contracts_family_user_id_idx" ON "app_db"."contracts" USING btree ("family_user_id");--> statement-breakpoint
CREATE INDEX "contracts_provider_user_id_idx" ON "app_db"."contracts" USING btree ("provider_user_id");--> statement-breakpoint
CREATE INDEX "contracts_status_idx" ON "app_db"."contracts" USING btree ("status");--> statement-breakpoint
CREATE TABLE "app_db"."contract_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"proposed_by_user_id" text NOT NULL,
	"status" "app_db"."contract_version_status" DEFAULT 'draft' NOT NULL,
	"services" jsonb NOT NULL,
	"schedule" text,
	"starts_on" date,
	"sent_at" timestamp,
	"decided_at" timestamp,
	"decline_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."contract_versions" ADD CONSTRAINT "contract_versions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_versions" ADD CONSTRAINT "contract_versions_proposed_by_user_id_user_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_versions_contract_version_uidx" ON "app_db"."contract_versions" USING btree ("contract_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_versions_pending_uidx" ON "app_db"."contract_versions" USING btree ("contract_id") WHERE "status" in ('draft', 'proposed');--> statement-breakpoint
CREATE UNIQUE INDEX "contract_versions_accepted_uidx" ON "app_db"."contract_versions" USING btree ("contract_id") WHERE "status" = 'accepted';--> statement-breakpoint
CREATE INDEX "contract_versions_contract_id_idx" ON "app_db"."contract_versions" USING btree ("contract_id");
