-- Mandatory Poppynz safety verification for families and helpers.
--
-- One record per applicant per role: somebody who is both a family and a
-- helper is screened twice and the two rows never mix. Rejected and expired
-- rows are kept as history, so the uniqueness constraint is partial — at most
-- one LIVE record per (user, role) — and re-verification inserts a fresh row
-- rather than mutating the audit trail.
CREATE TYPE "app_db"."safety_verification_status" AS ENUM('not_started', 'payment_pending', 'invited', 'in_progress', 'review_required', 'verified', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "app_db"."safety_verification_route" AS ENUM('credibled', 'uploaded_document');--> statement-breakpoint

CREATE TABLE "app_db"."safety_verifications" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "user_id" text NOT NULL,
  "role" "app_db"."access_control_role" NOT NULL,
  "status" "app_db"."safety_verification_status" DEFAULT 'not_started' NOT NULL,
  "route" "app_db"."safety_verification_route",
  "credibled_check_uuid" text,
  "credibled_check_type_value" text,
  "application_url" text,
  "consent_at" timestamp,
  "consent_policy_version" text,
  "payment_reference" text,
  "refund_reference" text,
  "amount_cents" integer,
  "fee_cents" integer,
  "tax_cents" integer,
  "total_cents" integer,
  "issuing_authority" text,
  "document_number" text,
  "filename" text,
  "file_key" text,
  "issued_on" date,
  "expires_on" date,
  "reviewed_by" text,
  "reviewed_at" timestamp,
  "decision_reason" text,
  "expiry_notified_at" timestamp,
  "order_attempts" integer DEFAULT 0 NOT NULL,
  "last_order_error" text,
  "deleted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "app_db"."safety_verifications"
  ADD CONSTRAINT "safety_verifications_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."safety_verifications"
  ADD CONSTRAINT "safety_verifications_reviewed_by_user_id_fk"
  FOREIGN KEY ("reviewed_by") REFERENCES "app_db"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- At most one live record per applicant per role. Terminal states are excluded
-- so history accumulates without blocking re-verification.
CREATE UNIQUE INDEX "safety_verifications_user_role_live_uidx"
  ON "app_db"."safety_verifications" ("user_id", "role")
  WHERE "deleted_at" is null and "status" not in ('rejected', 'expired');--> statement-breakpoint
-- Credibled's uuid is the only join key their webhooks give us, so it has to
-- be unique or a replayed delivery could update the wrong applicant.
CREATE UNIQUE INDEX "safety_verifications_credibled_uuid_uidx"
  ON "app_db"."safety_verifications" ("credibled_check_uuid")
  WHERE "credibled_check_uuid" is not null;--> statement-breakpoint
CREATE INDEX "safety_verifications_user_id_idx" ON "app_db"."safety_verifications" ("user_id");--> statement-breakpoint
CREATE INDEX "safety_verifications_status_idx" ON "app_db"."safety_verifications" ("status");--> statement-breakpoint
CREATE INDEX "safety_verifications_status_expires_on_idx" ON "app_db"."safety_verifications" ("status", "expires_on");
