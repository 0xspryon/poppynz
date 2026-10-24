-- Staging UAT fixes (2026-10-12 findings), one migration for the whole round.
-- Everything is additive: new columns are nullable or defaulted and the new
-- tables are empty, so it applies on top of 0030–0034 in any order.
--
-- #1/#18 credential gate: a catalogue item can require an admin-approved
-- document (Personal support needs the PSW credential).
ALTER TABLE "app_db"."service_catalogue" ADD COLUMN "required_document_type_id" uuid;--> statement-breakpoint
ALTER TABLE "app_db"."service_catalogue" ADD CONSTRAINT "service_catalogue_required_document_type_id_kyc_document_types_id_fk" FOREIGN KEY ("required_document_type_id") REFERENCES "app_db"."kyc_document_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- #34 custom services wait for an admin decision before families see them.
CREATE TYPE "app_db"."service_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "app_db"."services_offered" ADD COLUMN "review_status" "app_db"."service_review_status" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_db"."services_offered" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "app_db"."services_offered" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "app_db"."services_offered" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "app_db"."services_offered" ADD CONSTRAINT "services_offered_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "app_db"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "services_offered_review_status_idx" ON "app_db"."services_offered" USING btree ("review_status");--> statement-breakpoint
-- Existing custom services were never reviewed (the staging $5.00 test
-- service among them): they go to the queue rather than staying public.
UPDATE "app_db"."services_offered" SET "review_status" = 'pending'
  WHERE "catalogue_service_id" IS NULL AND "deleted_at" IS NULL;--> statement-breakpoint
-- #27 per-document review with reviewer and time; #31 the issue date.
ALTER TABLE "app_db"."kyc_documents" ADD COLUMN "issued_on" date;--> statement-breakpoint
ALTER TABLE "app_db"."kyc_documents" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "app_db"."kyc_documents" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "app_db"."kyc_documents" ADD CONSTRAINT "kyc_documents_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "app_db"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- #41 the family's explicit "Sign & send".
ALTER TABLE "app_db"."contract_versions" ADD COLUMN "family_signed_at" timestamp;--> statement-breakpoint
-- #16 server-side dismissal of one-off prompts.
CREATE TABLE "app_db"."user_dismissals" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"dismissed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_dismissals_user_id_key_pk" PRIMARY KEY("user_id","key")
);--> statement-breakpoint
ALTER TABLE "app_db"."user_dismissals" ADD CONSTRAINT "user_dismissals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- #38 a record of every contact-detail warning shown in chat.
CREATE TABLE "app_db"."contact_detail_warnings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"sender_user_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"kinds" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."contact_detail_warnings" ADD CONSTRAINT "contact_detail_warnings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app_db"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contact_detail_warnings" ADD CONSTRAINT "contact_detail_warnings_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "app_db"."conversation_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contact_detail_warnings" ADD CONSTRAINT "contact_detail_warnings_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contact_detail_warnings" ADD CONSTRAINT "contact_detail_warnings_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_detail_warnings_message_uidx" ON "app_db"."contact_detail_warnings" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "contact_detail_warnings_conversation_idx" ON "app_db"."contact_detail_warnings" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_detail_warnings_sender_idx" ON "app_db"."contact_detail_warnings" USING btree ("sender_user_id");
