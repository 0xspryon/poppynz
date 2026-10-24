-- Round 3 review fixes. Apply after 0036 (drizzle only applies entries whose
-- journal `when` is later than the last applied one).
--
-- R2: a catalogue-linked service carries its catalogue item's name and no
-- free-text description. Rows linked before that rule kept what the helper
-- typed (a custom "Personal support (PSW)" relinked to a credential-free
-- item, say), so normalise them. Contracts keep their own snapshots.
UPDATE "app_db"."services_offered" AS so
   SET "name" = sc."name", "description" = NULL, "updated_at" = now()
  FROM "app_db"."service_catalogue" AS sc
 WHERE so."catalogue_service_id" = sc."id"
   AND (so."name" IS DISTINCT FROM sc."name" OR so."description" IS NOT NULL);--> statement-breakpoint
-- R11: vouch requests to an email that can't vouch are kept, never delivered,
-- so the applicant's list looks the same whoever the email belongs to.
CREATE TABLE "app_db"."undelivered_vouch_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"applicant_user_id" text NOT NULL,
	"voucher_email" text NOT NULL,
	"relationship" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."undelivered_vouch_requests" ADD CONSTRAINT "undelivered_vouch_requests_applicant_user_id_user_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "undelivered_vouch_requests_applicant_idx" ON "app_db"."undelivered_vouch_requests" USING btree ("applicant_user_id");--> statement-breakpoint
-- U7: per-locale terms. Existing versions are the English (authoritative)
-- text; a translation shares its English revision's version number, so the
-- uniqueness rules gain the locale.
ALTER TABLE "app_db"."tc_document_versions" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_db"."tc_document_versions" ADD CONSTRAINT "tc_document_versions_locale_check" CHECK ("app_db"."tc_document_versions"."locale" in ('en', 'fr'));--> statement-breakpoint
DROP INDEX "app_db"."tc_document_versions_document_id_version_uidx";--> statement-breakpoint
DROP INDEX "app_db"."tc_document_versions_document_id_draft_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "tc_document_versions_document_id_locale_version_uidx" ON "app_db"."tc_document_versions" USING btree ("document_id","locale","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tc_document_versions_document_id_locale_draft_uidx" ON "app_db"."tc_document_versions" USING btree ("document_id","locale") WHERE "app_db"."tc_document_versions"."published_at" is null;
