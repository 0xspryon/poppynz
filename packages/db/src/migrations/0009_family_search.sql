CREATE TYPE "app_db"."family_search_outbox_status" AS ENUM('pending', 'processing', 'processed', 'failed', 'superseded');--> statement-breakpoint
CREATE TABLE "app_db"."services_needed" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"catalogue_service_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."services_needed" ADD CONSTRAINT "services_needed_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."services_needed" ADD CONSTRAINT "services_needed_catalogue_service_id_service_catalogue_id_fk" FOREIGN KEY ("catalogue_service_id") REFERENCES "app_db"."service_catalogue"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "services_needed_user_id_idx" ON "app_db"."services_needed" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "services_needed_deleted_at_idx" ON "app_db"."services_needed" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "services_needed_catalogue_service_id_idx" ON "app_db"."services_needed" USING btree ("catalogue_service_id");--> statement-breakpoint
CREATE TABLE "app_db"."family_search_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"status" "app_db"."family_search_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."family_search_outbox" ADD CONSTRAINT "family_search_outbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "family_search_outbox_user_id_idx" ON "app_db"."family_search_outbox" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "family_search_outbox_status_idx" ON "app_db"."family_search_outbox" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "family_search_outbox_user_unresolved_uidx" ON "app_db"."family_search_outbox" USING btree ("user_id") WHERE "status" in ('pending', 'processing', 'failed');
