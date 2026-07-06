CREATE TYPE "app_db"."provider_search_outbox_status" AS ENUM('pending', 'processing', 'processed', 'failed', 'superseded');--> statement-breakpoint
CREATE TABLE "app_db"."provider_search_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"status" "app_db"."provider_search_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."provider_search_outbox" ADD CONSTRAINT "provider_search_outbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_search_outbox_user_id_idx" ON "app_db"."provider_search_outbox" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "provider_search_outbox_status_idx" ON "app_db"."provider_search_outbox" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_search_outbox_user_unresolved_uidx" ON "app_db"."provider_search_outbox" USING btree ("user_id") WHERE "status" in ('pending', 'processing', 'failed');
