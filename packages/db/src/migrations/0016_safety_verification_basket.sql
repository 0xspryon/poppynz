-- Safety verification becomes a basket of checks rather than a single one.
--
-- Two changes drive this:
--
--   1. An applicant can now select several Credibled checks before paying, so
--      the single `credibled_check_type_value` on the verification becomes a
--      set of items.
--   2. Credibled's API exposes no pricing, so what each check costs has to be
--      configured by an admin. It lives on the document type, next to the
--      check-type mapping it prices.

-- Pre-tax price of the check this document type maps to, in cents. NULL is
-- only valid for upload-only types; a fetchable type without a price is a
-- configuration error, enforced in the API rather than by a constraint so the
-- admin can save the mapping and the price in either order.
ALTER TABLE "app_db"."kyc_document_types"
  ADD COLUMN "credibled_cost_cents" integer;--> statement-breakpoint

CREATE TABLE "app_db"."safety_verification_items" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "verification_id" uuid NOT NULL,
  "document_type_id" uuid NOT NULL,
  "credibled_check_type_value" text NOT NULL,
  -- Frozen when the item is added: an admin editing the price mid-basket must
  -- not change what the applicant was quoted.
  "cost_cents" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "app_db"."safety_verification_items"
  ADD CONSTRAINT "safety_verification_items_verification_id_fk"
  FOREIGN KEY ("verification_id") REFERENCES "app_db"."safety_verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."safety_verification_items"
  ADD CONSTRAINT "safety_verification_items_document_type_id_fk"
  FOREIGN KEY ("document_type_id") REFERENCES "app_db"."kyc_document_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "safety_verification_items_verification_type_uidx"
  ON "app_db"."safety_verification_items" ("verification_id", "document_type_id");--> statement-breakpoint
-- Two document types can map to the same Credibled check; ordering it twice
-- would be billed twice and fulfilled once.
CREATE UNIQUE INDEX "safety_verification_items_verification_check_uidx"
  ON "app_db"."safety_verification_items" ("verification_id", "credibled_check_type_value");--> statement-breakpoint
CREATE INDEX "safety_verification_items_verification_id_idx"
  ON "app_db"."safety_verification_items" ("verification_id");--> statement-breakpoint

-- Carry any in-flight single selection over into the new item table before the
-- column goes. Dev data only — nothing has been ordered in anger yet.
INSERT INTO "app_db"."safety_verification_items"
  ("verification_id", "document_type_id", "credibled_check_type_value", "cost_cents")
SELECT sv."id", dt."id", sv."credibled_check_type_value", 0
FROM "app_db"."safety_verifications" sv
JOIN "app_db"."kyc_document_types" dt
  ON dt."credibled_check_type_value" = sv."credibled_check_type_value"
WHERE sv."credibled_check_type_value" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

ALTER TABLE "app_db"."safety_verifications" DROP COLUMN "credibled_check_type_value";
