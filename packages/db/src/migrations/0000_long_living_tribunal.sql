CREATE TYPE "public"."approval_status" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('service-provider', 'family');--> statement-breakpoint
CREATE TYPE "public"."kyc_document_status" AS ENUM('missing', 'uploaded', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."kyc_document_type" AS ENUM('government-id', 'vulnerable-sector-check', 'first-aid-certification', 'driving-license');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "approval_type" NOT NULL,
	"status" "approval_status" NOT NULL,
	"approved_by" text,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "kyc_document_type" NOT NULL,
	"filename" text,
	"file_key" text,
	"status" "kyc_document_status" NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_user_id_idx" ON "approvals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_user_id_type_uidx" ON "approvals" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "kyc_documents_user_id_idx" ON "kyc_documents" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_documents_user_id_type_uidx" ON "kyc_documents" USING btree ("user_id","type");
