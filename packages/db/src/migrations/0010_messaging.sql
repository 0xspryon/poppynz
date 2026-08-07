CREATE TYPE "app_db"."conversation_status" AS ENUM('pending', 'active', 'ignored');--> statement-breakpoint
CREATE TABLE "app_db"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_user_id" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"initiator_user_id" text NOT NULL,
	"status" "app_db"."conversation_status" DEFAULT 'pending' NOT NULL,
	"reachout_message" text NOT NULL,
	"reachout_services" jsonb NOT NULL,
	"responded_at" timestamp,
	"ignored_at" timestamp,
	"family_last_read_at" timestamp,
	"provider_last_read_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."conversations" ADD CONSTRAINT "conversations_family_user_id_user_id_fk" FOREIGN KEY ("family_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."conversations" ADD CONSTRAINT "conversations_provider_user_id_user_id_fk" FOREIGN KEY ("provider_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."conversations" ADD CONSTRAINT "conversations_initiator_user_id_user_id_fk" FOREIGN KEY ("initiator_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_family_provider_uidx" ON "app_db"."conversations" USING btree ("family_user_id","provider_user_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "conversations_provider_user_id_idx" ON "app_db"."conversations" USING btree ("provider_user_id");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "app_db"."conversations" USING btree ("status");--> statement-breakpoint
CREATE TABLE "app_db"."conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" text NOT NULL,
	"body" text NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app_db"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."conversation_messages" ADD CONSTRAINT "conversation_messages_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_created_idx" ON "app_db"."conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_sender_user_id_idx" ON "app_db"."conversation_messages" USING btree ("sender_user_id");
