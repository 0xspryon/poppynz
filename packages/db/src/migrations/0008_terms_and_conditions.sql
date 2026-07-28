CREATE TYPE "app_db"."tc_applies_to_role" AS ENUM('all', 'family', 'service-provider');--> statement-breakpoint

CREATE TABLE "app_db"."tc_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"applies_to_role" "app_db"."tc_applies_to_role" DEFAULT 'all' NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "app_db"."tc_document_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"description" text NOT NULL,
	"content" text NOT NULL,
	"checkbox_label" text NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "app_db"."tc_document_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"version_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "app_db"."tc_document_versions" ADD CONSTRAINT "tc_document_versions_document_id_tc_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app_db"."tc_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."tc_document_acceptances" ADD CONSTRAINT "tc_document_acceptances_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."tc_document_acceptances" ADD CONSTRAINT "tc_document_acceptances_document_id_tc_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app_db"."tc_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."tc_document_acceptances" ADD CONSTRAINT "tc_document_acceptances_version_id_tc_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app_db"."tc_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "tc_documents_slug_uidx" ON "app_db"."tc_documents" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tc_documents_deleted_at_idx" ON "app_db"."tc_documents" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "tc_document_versions_document_id_idx" ON "app_db"."tc_document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tc_document_versions_document_id_version_uidx" ON "app_db"."tc_document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tc_document_versions_document_id_draft_uidx" ON "app_db"."tc_document_versions" USING btree ("document_id") WHERE "tc_document_versions"."published_at" is null;--> statement-breakpoint
CREATE INDEX "tc_document_acceptances_user_id_idx" ON "app_db"."tc_document_acceptances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tc_document_acceptances_version_id_idx" ON "app_db"."tc_document_acceptances" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tc_document_acceptances_user_id_version_id_uidx" ON "app_db"."tc_document_acceptances" USING btree ("user_id","version_id");
