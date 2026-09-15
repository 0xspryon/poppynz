-- A completed Credibled check becomes a document.
--
-- Until now the only thing a completed Credibled order changed was the safety
-- verdict; the individual checks it fetched (criminal record, driver's
-- abstract, first aid) left no row in `kyc_documents`, so a helper who paid
-- to have one fetched still saw the checklist entry reading "missing".
--
-- `source` records how a document came to exist. A fetched document holds no
-- file and no expiry — only that the check completed — and the report itself
-- stays with the vendor, opened on demand from the safety-verification review.
CREATE TYPE "app_db"."kyc_document_source" AS ENUM('upload', 'credibled');--> statement-breakpoint
ALTER TABLE "app_db"."kyc_documents"
  ADD COLUMN "source" "app_db"."kyc_document_source" DEFAULT 'upload' NOT NULL;
