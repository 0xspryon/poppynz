-- Marks the document type that IS the safety-verification evidence.
--
-- Uploading a vulnerable-sector check used to happen on the Safety
-- verification page, in parallel with the ordinary document upload on the
-- Documents page — same physical document, two tables, two admin queues, and
-- only one of them moved the safety gate. This flag lets the Documents page be
-- the single place evidence is supplied: an upload against a flagged type
-- writes the safety_verification record, and the checklist reads its status
-- back from there rather than from kyc_documents.
ALTER TABLE "app_db"."kyc_document_types"
  ADD COLUMN "backs_safety_verification" boolean DEFAULT false NOT NULL;
