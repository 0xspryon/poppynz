-- Exactly one safety-gate document type per role.
--
-- `backs_safety_verification` was a plain boolean with nothing stopping two
-- types for the same role from carrying it; the checklist would then render
-- two entries both reading the same verdict. It becomes `is_safety_gate` and
-- gains a partial unique index — which matters now, because a family gate
-- type is exactly the second row about to appear.
ALTER TABLE "app_db"."kyc_document_types"
  RENAME COLUMN "backs_safety_verification" TO "is_safety_gate";--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_document_types_role_gate_uidx"
  ON "app_db"."kyc_document_types" ("applies_to_role")
  WHERE "is_safety_gate" AND "deleted_at" IS NULL;
