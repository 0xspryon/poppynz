-- Payment and vendor state leave the safety verdict.
--
-- `safety_verifications` had been carrying three things at once: the
-- administrator's decision, the Credibled order that might have produced the
-- evidence, and the charge that paid for it. Stripe is next — for these orders
-- AND for bookings — and a payment webhook cannot sensibly resolve a
-- PaymentIntent against a safety-verdict table, nor can bookings reuse any of
-- it. So:
--
--   payments          one row per charge attempt, provider-agnostic, keyed for
--                     an asynchronous confirmation; bookings become a second
--                     `kind`, not a second integration.
--   check_orders      the basket, the charge it settled with, and Credibled's
--                     progress. Only a `complete` order creates a verdict.
--   check_order_items the basket lines, moved over unchanged.
--   safety_verifications
--                     the verdict only. Status shrinks to the four decision
--                     states; `route` becomes NOT NULL because a verdict is
--                     now only ever created with evidence behind it.
--
-- The backfill is best-effort: nothing is in production and staging holds
-- nothing that needs preserving (matching the stance 0016 took). It still
-- carries every row across, and every Credibled-route verification becomes an
-- order with the SAME id so the history stays traceable by eye. (A place-order
-- job already queued under the old payload does not resolve — the worker's
-- boot-time recovery sweep re-places any paid-but-unplaced order.)

CREATE TYPE "app_db"."payment_kind" AS ENUM('credibled_order');--> statement-breakpoint
CREATE TYPE "app_db"."payment_status" AS ENUM('pending', 'authorised', 'captured', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "app_db"."check_order_status" AS ENUM('draft', 'payment_pending', 'paid', 'invited', 'in_progress', 'complete', 'failed', 'cancelled');--> statement-breakpoint

CREATE TABLE "app_db"."payments" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "user_id" text NOT NULL,
  "kind" "app_db"."payment_kind" NOT NULL,
  "status" "app_db"."payment_status" DEFAULT 'pending' NOT NULL,
  "provider" text NOT NULL,
  "provider_reference" text,
  "refund_reference" text,
  "amount_cents" integer NOT NULL,
  "fee_cents" integer NOT NULL,
  "tax_cents" integer NOT NULL,
  "total_cents" integer NOT NULL,
  "currency" text DEFAULT 'CAD' NOT NULL,
  "last_error" text,
  "authorised_at" timestamp,
  "captured_at" timestamp,
  "refunded_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "app_db"."payments"
  ADD CONSTRAINT "payments_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- How an inbound provider event finds its row.
CREATE UNIQUE INDEX "payments_provider_reference_uidx"
  ON "app_db"."payments" ("provider", "provider_reference")
  WHERE "provider_reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_user_id_idx" ON "app_db"."payments" ("user_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "app_db"."payments" ("status");--> statement-breakpoint

CREATE TABLE "app_db"."check_orders" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "user_id" text NOT NULL,
  "role" "app_db"."access_control_role" NOT NULL,
  "status" "app_db"."check_order_status" DEFAULT 'draft' NOT NULL,
  "payment_id" uuid,
  "credibled_check_uuid" text,
  "application_url" text,
  "consent_at" timestamp,
  "consent_policy_version" text,
  "order_attempts" integer DEFAULT 0 NOT NULL,
  "last_order_error" text,
  "completed_at" timestamp,
  "deleted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "app_db"."check_orders"
  ADD CONSTRAINT "check_orders_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."check_orders"
  ADD CONSTRAINT "check_orders_payment_id_payments_id_fk"
  FOREIGN KEY ("payment_id") REFERENCES "app_db"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- At most one open order per applicant per role, mirroring the verdict's
-- live-slot index. Finished orders accumulate as history.
CREATE UNIQUE INDEX "check_orders_user_role_open_uidx"
  ON "app_db"."check_orders" ("user_id", "role")
  WHERE "deleted_at" IS NULL AND "status" IN ('draft', 'payment_pending', 'paid', 'invited', 'in_progress');--> statement-breakpoint
CREATE UNIQUE INDEX "check_orders_credibled_uuid_uidx"
  ON "app_db"."check_orders" ("credibled_check_uuid")
  WHERE "credibled_check_uuid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "check_orders_user_id_idx" ON "app_db"."check_orders" ("user_id");--> statement-breakpoint
CREATE INDEX "check_orders_status_idx" ON "app_db"."check_orders" ("status");--> statement-breakpoint

CREATE TABLE "app_db"."check_order_items" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "order_id" uuid NOT NULL,
  "document_type_id" uuid NOT NULL,
  "credibled_check_type_value" text NOT NULL,
  "cost_cents" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "app_db"."check_order_items"
  ADD CONSTRAINT "check_order_items_order_id_check_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "app_db"."check_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."check_order_items"
  ADD CONSTRAINT "check_order_items_document_type_id_kyc_document_types_id_fk"
  FOREIGN KEY ("document_type_id") REFERENCES "app_db"."kyc_document_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "check_order_items_order_type_uidx"
  ON "app_db"."check_order_items" ("order_id", "document_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "check_order_items_order_check_uidx"
  ON "app_db"."check_order_items" ("order_id", "credibled_check_type_value");--> statement-breakpoint
CREATE INDEX "check_order_items_order_id_idx" ON "app_db"."check_order_items" ("order_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Every Credibled-route verification becomes an order, id preserved. Rows that
-- never picked a route are baskets, which were always Credibled.
INSERT INTO "app_db"."check_orders"
  ("id", "user_id", "role", "status", "credibled_check_uuid", "application_url",
   "consent_at", "consent_policy_version", "order_attempts", "last_order_error",
   "completed_at", "deleted_at", "created_at", "updated_at")
SELECT
  sv."id", sv."user_id", sv."role",
  (CASE sv."status"::text
    WHEN 'not_started' THEN 'draft'
    WHEN 'payment_pending' THEN CASE WHEN sv."payment_reference" IS NULL THEN 'draft' ELSE 'paid' END
    WHEN 'invited' THEN 'invited'
    WHEN 'in_progress' THEN 'in_progress'
    -- A rejected row was one of three things: the refund path (never placed,
    -- so no check uuid), an administrator declining a completed check (a
    -- uuid and a reviewer), or Credibled cancelling it (a uuid, no reviewer).
    WHEN 'rejected' THEN CASE
      WHEN sv."credibled_check_uuid" IS NULL THEN 'failed'
      WHEN sv."reviewed_by" IS NOT NULL THEN 'complete'
      ELSE 'cancelled' END
    ELSE 'complete'
  END)::"app_db"."check_order_status",
  sv."credibled_check_uuid", sv."application_url",
  sv."consent_at", sv."consent_policy_version", sv."order_attempts", sv."last_order_error",
  CASE
    WHEN sv."status" IN ('review_required', 'verified', 'expired')
      OR (sv."status" = 'rejected' AND sv."credibled_check_uuid" IS NOT NULL AND sv."reviewed_by" IS NOT NULL)
    THEN sv."updated_at"
  END,
  sv."deleted_at", sv."created_at", sv."updated_at"
FROM "app_db"."safety_verifications" sv
WHERE sv."route" IS DISTINCT FROM 'uploaded_document';--> statement-breakpoint

-- Every reference issued so far came from the mock provider — Stripe has not
-- been wired — so `provider` is a constant here.
INSERT INTO "app_db"."payments"
  ("id", "user_id", "kind", "status", "provider", "provider_reference", "refund_reference",
   "amount_cents", "fee_cents", "tax_cents", "total_cents", "currency",
   "authorised_at", "refunded_at", "created_at", "updated_at")
SELECT
  sv."id", sv."user_id", 'credibled_order',
  (CASE WHEN sv."refund_reference" IS NOT NULL THEN 'refunded' ELSE 'authorised' END)::"app_db"."payment_status",
  'mock', sv."payment_reference", sv."refund_reference",
  coalesce(sv."amount_cents", 0), coalesce(sv."fee_cents", 0), coalesce(sv."tax_cents", 0), coalesce(sv."total_cents", 0),
  'CAD',
  sv."updated_at",
  CASE WHEN sv."refund_reference" IS NOT NULL THEN sv."updated_at" END,
  sv."created_at", sv."updated_at"
FROM "app_db"."safety_verifications" sv
WHERE sv."payment_reference" IS NOT NULL
  AND sv."route" IS DISTINCT FROM 'uploaded_document';--> statement-breakpoint

UPDATE "app_db"."check_orders" o
  SET "payment_id" = o."id"
  WHERE EXISTS (SELECT 1 FROM "app_db"."payments" p WHERE p."id" = o."id");--> statement-breakpoint

INSERT INTO "app_db"."check_order_items"
  ("id", "order_id", "document_type_id", "credibled_check_type_value", "cost_cents", "created_at")
SELECT i."id", i."verification_id", i."document_type_id", i."credibled_check_type_value", i."cost_cents", i."created_at"
FROM "app_db"."safety_verification_items" i
WHERE i."verification_id" IN (SELECT "id" FROM "app_db"."check_orders");--> statement-breakpoint

DROP TABLE "app_db"."safety_verification_items";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The verdict table
-- ---------------------------------------------------------------------------

ALTER TABLE "app_db"."safety_verifications" ADD COLUMN "check_order_id" uuid;--> statement-breakpoint
ALTER TABLE "app_db"."safety_verifications"
  ADD CONSTRAINT "safety_verifications_check_order_id_check_orders_id_fk"
  FOREIGN KEY ("check_order_id") REFERENCES "app_db"."check_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Pre-verdict rows are orders now; they no longer belong here. Nor do the two
-- kinds of `rejected` row that never had evidence behind them: the refund
-- path (never placed, no check uuid) and a Credibled cancellation (a uuid but
-- no reviewer). Under the new model those are a failed and a cancelled order
-- respectively, and nothing else. An administrator's rejection of a completed
-- check (uuid AND reviewer) is a real decision and stays.
DELETE FROM "app_db"."safety_verifications"
  WHERE "status" IN ('not_started', 'payment_pending', 'invited', 'in_progress')
     OR ("status" = 'rejected' AND "route" = 'credibled'
         AND ("credibled_check_uuid" IS NULL OR "reviewed_by" IS NULL));--> statement-breakpoint
UPDATE "app_db"."safety_verifications"
  SET "check_order_id" = "id"
  WHERE "route" = 'credibled';--> statement-breakpoint
-- A verdict without a route can only have been an upload (baskets were
-- deleted above).
UPDATE "app_db"."safety_verifications"
  SET "route" = 'uploaded_document'
  WHERE "route" IS NULL;--> statement-breakpoint
ALTER TABLE "app_db"."safety_verifications" ALTER COLUMN "route" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "app_db"."safety_verifications"
  DROP COLUMN "credibled_check_uuid",
  DROP COLUMN "application_url",
  DROP COLUMN "payment_reference",
  DROP COLUMN "refund_reference",
  DROP COLUMN "amount_cents",
  DROP COLUMN "fee_cents",
  DROP COLUMN "tax_cents",
  DROP COLUMN "total_cents",
  DROP COLUMN "order_attempts",
  DROP COLUMN "last_order_error";--> statement-breakpoint

-- Postgres cannot remove values from an enum in place, so the status type is
-- rebuilt. The partial index names status values in its predicate and has to
-- be recreated around the change; the plain ones are dropped alongside it for
-- symmetry.
DROP INDEX "app_db"."safety_verifications_user_role_live_uidx";--> statement-breakpoint
DROP INDEX "app_db"."safety_verifications_status_idx";--> statement-breakpoint
DROP INDEX "app_db"."safety_verifications_status_expires_on_idx";--> statement-breakpoint
ALTER TABLE "app_db"."safety_verifications" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "app_db"."safety_verification_status" RENAME TO "safety_verification_status_old";--> statement-breakpoint
CREATE TYPE "app_db"."safety_verification_status" AS ENUM('review_required', 'verified', 'rejected', 'expired');--> statement-breakpoint
ALTER TABLE "app_db"."safety_verifications"
  ALTER COLUMN "status" TYPE "app_db"."safety_verification_status"
  USING "status"::text::"app_db"."safety_verification_status";--> statement-breakpoint
DROP TYPE "app_db"."safety_verification_status_old";--> statement-breakpoint

CREATE UNIQUE INDEX "safety_verifications_user_role_live_uidx"
  ON "app_db"."safety_verifications" ("user_id", "role")
  WHERE "deleted_at" IS NULL AND "status" NOT IN ('rejected', 'expired');--> statement-breakpoint
CREATE INDEX "safety_verifications_check_order_id_idx" ON "app_db"."safety_verifications" ("check_order_id");--> statement-breakpoint
CREATE INDEX "safety_verifications_status_idx" ON "app_db"."safety_verifications" ("status");--> statement-breakpoint
CREATE INDEX "safety_verifications_status_expires_on_idx" ON "app_db"."safety_verifications" ("status", "expires_on");
