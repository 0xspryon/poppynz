-- Vouches: an approved member endorses a helper applicant. A nudge, not a
-- gate — approval never reads this table. Whether a vouch COUNTS is derived at
-- read time from the row plus the voucher's current standing, so nothing here
-- stores "counted" or "expired".
CREATE TYPE "app_db"."vouch_status" AS ENUM('pending', 'accepted', 'declined', 'revoked', 'flagged');--> statement-breakpoint
CREATE TABLE "app_db"."vouches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"applicant_user_id" text NOT NULL,
	"voucher_user_id" text NOT NULL,
	"voucher_role" "app_db"."access_control_role" NOT NULL,
	"relationship" text NOT NULL,
	"status" "app_db"."vouch_status" DEFAULT 'pending' NOT NULL,
	"answers" jsonb,
	"attested_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"decided_at" timestamp,
	"revoked_by" text,
	"admin_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."vouches" ADD CONSTRAINT "vouches_applicant_user_id_user_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."vouches" ADD CONSTRAINT "vouches_voucher_user_id_user_id_fk" FOREIGN KEY ("voucher_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."vouches" ADD CONSTRAINT "vouches_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "app_db"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vouches_applicant_user_id_idx" ON "app_db"."vouches" USING btree ("applicant_user_id");--> statement-breakpoint
CREATE INDEX "vouches_voucher_user_id_idx" ON "app_db"."vouches" USING btree ("voucher_user_id");--> statement-breakpoint
-- One person fills one slot: at most one accepted vouch per pair.
CREATE UNIQUE INDEX "vouches_pair_accepted_uidx" ON "app_db"."vouches" USING btree ("applicant_user_id", "voucher_user_id") WHERE "status" = 'accepted';--> statement-breakpoint
ALTER TABLE "app_db"."approval_requests"
  ADD COLUMN "general_remarks" text,
  ADD COLUMN "general_remarks_updated_by" text,
  ADD COLUMN "general_remarks_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "app_db"."approval_requests" ADD CONSTRAINT "approval_requests_general_remarks_updated_by_user_id_fk" FOREIGN KEY ("general_remarks_updated_by") REFERENCES "app_db"."user"("id") ON DELETE set null ON UPDATE no action;
