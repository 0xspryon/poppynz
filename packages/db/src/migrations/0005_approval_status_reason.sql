ALTER TABLE "app_db"."approvals" ADD COLUMN "status" "app_db"."approval_status" DEFAULT 'rejected' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_db"."approvals" ADD COLUMN "reason" text;