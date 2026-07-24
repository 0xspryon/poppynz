ALTER TABLE "app_db"."approvals" ADD COLUMN "notified_expires_in_one_month_at" timestamp;--> statement-breakpoint
ALTER TABLE "app_db"."approvals" ADD COLUMN "notified_expires_in_two_weeks_at" timestamp;--> statement-breakpoint
ALTER TABLE "app_db"."approvals" ADD COLUMN "notified_expires_in_one_week_at" timestamp;--> statement-breakpoint
ALTER TABLE "app_db"."approvals" ADD COLUMN "notified_expires_in_two_days_at" timestamp;--> statement-breakpoint
CREATE INDEX "approvals_status_expires_at_idx" ON "app_db"."approvals" ("status","expires_at");
