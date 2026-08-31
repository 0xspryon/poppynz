-- Credibled check types on document types.
--
-- `is_fetchable` was a boolean: it said WHETHER Credibled could fetch a
-- document but not WHICH check to order, so it could never actually drive an
-- API call. It becomes a nullable reference to Credibled's stable check-type
-- `value` (never its uuid — uuids are issued per Credibled account and change
-- when keys are rotated or a second account is enabled). Fetchability is now
-- derived from this column being non-null, so the two facts cannot disagree.
ALTER TABLE "app_db"."kyc_document_types"
  ADD COLUMN "credibled_check_type_value" text;--> statement-breakpoint

-- Deliberately NOT backfilled from is_fetchable. A true flag carried no
-- indication of which check it meant, and at least one seeded type it could
-- have been set on — Vulnerable Sector Check — has no Credibled equivalent at
-- all. Every row starts upload-only; the 0004 seed sets the mappings that were
-- confirmed against the live account.
ALTER TABLE "app_db"."kyc_document_types" DROP COLUMN "is_fetchable";
