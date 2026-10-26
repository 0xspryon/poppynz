-- UAT round 2, item 4: the written service agreement both parties sign.
-- The template is a T&C document of the new kind "service_agreement" (the
-- T&C gate keeps showing "terms" only); each signature stores the exact
-- rendered text it covered. The default template is seeded by the seeder
-- (0007_service_agreement), not here.
CREATE TYPE "app_db"."tc_document_kind" AS ENUM('terms', 'service_agreement');--> statement-breakpoint
CREATE TYPE "app_db"."contract_agreement_signer" AS ENUM('family', 'helper');--> statement-breakpoint
ALTER TABLE "app_db"."tc_documents" ADD COLUMN "kind" "app_db"."tc_document_kind" DEFAULT 'terms' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tc_documents_service_agreement_uidx" ON "app_db"."tc_documents" USING btree ("kind") WHERE "tc_documents"."kind" = 'service_agreement' and "tc_documents"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE "app_db"."contract_agreement_signatures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"contract_version_id" uuid NOT NULL,
	"contract_version" integer NOT NULL,
	"signer_user_id" text NOT NULL,
	"signer_side" "app_db"."contract_agreement_signer" NOT NULL,
	"template_document_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"locale" text NOT NULL,
	"content" text NOT NULL,
	"content_sha256" text NOT NULL,
	"cancellation_policy_version_id" uuid,
	"cancellation_policy_version" integer,
	"signed_at" timestamp DEFAULT now() NOT NULL,
	"voided_at" timestamp,
	CONSTRAINT "contract_agreement_signatures_locale_check" CHECK ("contract_agreement_signatures"."locale" in ('en', 'fr')),
	CONSTRAINT "contract_agreement_signatures_sha256_check" CHECK ("contract_agreement_signatures"."content_sha256" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
ALTER TABLE "app_db"."contract_agreement_signatures" ADD CONSTRAINT "contract_agreement_signatures_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_agreement_signatures" ADD CONSTRAINT "contract_agreement_signatures_contract_version_id_contract_versions_id_fk" FOREIGN KEY ("contract_version_id") REFERENCES "app_db"."contract_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_agreement_signatures" ADD CONSTRAINT "contract_agreement_signatures_signer_user_id_user_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_agreement_signatures" ADD CONSTRAINT "contract_agreement_signatures_template_document_id_tc_documents_id_fk" FOREIGN KEY ("template_document_id") REFERENCES "app_db"."tc_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_agreement_signatures" ADD CONSTRAINT "contract_agreement_signatures_template_version_id_tc_document_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "app_db"."tc_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_agreement_signatures" ADD CONSTRAINT "contract_agreement_signatures_cancellation_policy_version_id_tc_document_versions_id_fk" FOREIGN KEY ("cancellation_policy_version_id") REFERENCES "app_db"."tc_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_agreement_signatures_contract_id_idx" ON "app_db"."contract_agreement_signatures" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_agreement_signatures_template_version_id_idx" ON "app_db"."contract_agreement_signatures" USING btree ("template_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_agreement_signatures_live_uidx" ON "app_db"."contract_agreement_signatures" USING btree ("contract_version_id","signer_side") WHERE "contract_agreement_signatures"."voided_at" is null;--> statement-breakpoint
-- A signature is evidence: refuse DELETE, and any UPDATE other than voiding
-- a live signature once.
CREATE FUNCTION "app_db"."contract_agreement_signatures_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE'
		AND OLD."voided_at" IS NULL
		AND NEW."voided_at" IS NOT NULL
		AND (to_jsonb(NEW) - 'voided_at') = (to_jsonb(OLD) - 'voided_at') THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'contract_agreement_signatures is append-only (only voiding a live signature is allowed)';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "contract_agreement_signatures_no_change" BEFORE UPDATE OR DELETE ON "app_db"."contract_agreement_signatures" FOR EACH ROW EXECUTE FUNCTION "app_db"."contract_agreement_signatures_append_only"();
