CREATE TYPE "app_db"."approval_request_status" AS ENUM('submitted', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "app_db"."kyc_document_status" ADD VALUE IF NOT EXISTS 'submitted';--> statement-breakpoint

CREATE TABLE "app_db"."kyc_document_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"applies_to_role" text DEFAULT 'service-provider' NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"requires_expiry_date" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "app_db"."kyc_documents" DROP CONSTRAINT IF EXISTS "kyc_documents_user_id_user_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "app_db"."kyc_documents_user_id_type_uidx";--> statement-breakpoint
ALTER TABLE "app_db"."kyc_documents" ADD COLUMN "document_type_id" uuid;--> statement-breakpoint
ALTER TABLE "app_db"."kyc_documents" ADD COLUMN "expiry_date" timestamp;--> statement-breakpoint
ALTER TABLE "app_db"."kyc_documents" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "app_db"."kyc_documents" ALTER COLUMN "document_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app_db"."kyc_documents" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "app_db"."kyc_documents" ADD CONSTRAINT "kyc_documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."kyc_documents" ADD CONSTRAINT "kyc_documents_document_type_id_kyc_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "app_db"."kyc_document_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kyc_document_types_deleted_at_idx" ON "app_db"."kyc_document_types" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "kyc_documents_document_type_id_idx" ON "app_db"."kyc_documents" USING btree ("document_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_documents_user_id_document_type_uidx" ON "app_db"."kyc_documents" USING btree ("user_id", "document_type_id");--> statement-breakpoint

DROP INDEX IF EXISTS "app_db"."approvals_user_id_type_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "app_db"."approvals_user_id_idx";--> statement-breakpoint
ALTER TABLE "app_db"."approvals" DROP CONSTRAINT IF EXISTS "approvals_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "app_db"."approvals" DROP CONSTRAINT IF EXISTS "approvals_approved_by_user_id_fk";--> statement-breakpoint
DROP TABLE "app_db"."approvals";--> statement-breakpoint

CREATE TABLE "app_db"."approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"status" "app_db"."approval_request_status" NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "app_db"."approvals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"approved_by" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "app_db"."services_offered" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"hourly_rate_cents" integer NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "app_db"."approval_requests" ADD CONSTRAINT "approval_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."approval_requests" ADD CONSTRAINT "approval_requests_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "app_db"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."approvals" ADD CONSTRAINT "approvals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."approvals" ADD CONSTRAINT "approvals_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "app_db"."approval_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."approvals" ADD CONSTRAINT "approvals_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."services_offered" ADD CONSTRAINT "services_offered_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "approval_requests_user_id_idx" ON "app_db"."approval_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "app_db"."approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approvals_user_id_idx" ON "app_db"."approvals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "approvals_request_id_idx" ON "app_db"."approvals" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "services_offered_user_id_idx" ON "app_db"."services_offered" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "services_offered_deleted_at_idx" ON "app_db"."services_offered" USING btree ("deleted_at");
