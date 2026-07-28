CREATE TABLE "app_db"."service_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"base_hourly_rate_cents" integer NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"is_live" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "service_catalogue_deleted_at_idx" ON "app_db"."service_catalogue" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "service_catalogue_is_live_idx" ON "app_db"."service_catalogue" USING btree ("is_live");--> statement-breakpoint
ALTER TABLE "app_db"."kyc_document_types" ADD COLUMN "is_fetchable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_db"."services_offered" ADD COLUMN "catalogue_service_id" uuid;--> statement-breakpoint
ALTER TABLE "app_db"."services_offered" ADD CONSTRAINT "services_offered_catalogue_service_id_service_catalogue_id_fk" FOREIGN KEY ("catalogue_service_id") REFERENCES "app_db"."service_catalogue"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "services_offered_catalogue_service_id_idx" ON "app_db"."services_offered" USING btree ("catalogue_service_id");
