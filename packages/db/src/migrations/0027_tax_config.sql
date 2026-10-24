-- Sales-tax configuration (piece 3, spec §3a). Data, not code: seeded with
-- defaults (seed 0004_tax_config) and corrected later by an accountant.
--
-- Effective-dated rows cover [effective_from, effective_to). An edit closes
-- the row in force and inserts a new one; a removal sets deleted_at; every
-- change appends a tax_config_audit row. The EXCLUDE constraints refuse two
-- live rows for the same key whose ranges overlap. Rates are thousandths of a
-- percent (basis points x 10): 5% = 5000, 9.975% = 9975.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "app_db"."tax_jurisdiction_kind" AS ENUM('federal', 'province', 'territory');--> statement-breakpoint
CREATE TYPE "app_db"."tax_component" AS ENUM('gst', 'hst', 'pst', 'qst', 'rst');--> statement-breakpoint
CREATE TYPE "app_db"."tax_treatment" AS ENUM('taxable', 'exempt', 'zero_rated', 'out_of_scope');--> statement-breakpoint
CREATE TYPE "app_db"."tax_place_of_supply" AS ENUM('payer_province', 'helper_province', 'contract_location');--> statement-breakpoint
CREATE TYPE "app_db"."tax_config_audit_action" AS ENUM('create', 'close', 'delete');--> statement-breakpoint
CREATE TABLE "app_db"."tax_jurisdictions" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "app_db"."tax_jurisdiction_kind" NOT NULL
);--> statement-breakpoint
CREATE TABLE "app_db"."tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"jurisdiction_code" text NOT NULL,
	"component" "app_db"."tax_component" NOT NULL,
	"rate_millipercent" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rates_rate_valid" CHECK ("rate_millipercent" BETWEEN 0 AND 100000),
	CONSTRAINT "tax_rates_range_valid" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
	CONSTRAINT "tax_rates_no_overlap" EXCLUDE USING gist (
		"jurisdiction_code" WITH =,
		"component" WITH =,
		daterange("effective_from", "effective_to", '[)') WITH &&
	) WHERE ("deleted_at" IS NULL)
);--> statement-breakpoint
CREATE TABLE "app_db"."tax_supply_types" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);--> statement-breakpoint
CREATE TABLE "app_db"."tax_supply_treatments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"supply_type_code" text NOT NULL,
	"treatment" "app_db"."tax_treatment" NOT NULL,
	"components" "app_db"."tax_component"[] NOT NULL,
	"place_of_supply" "app_db"."tax_place_of_supply" NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tax_supply_treatments_range_valid" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
	CONSTRAINT "tax_supply_treatments_no_overlap" EXCLUDE USING gist (
		"supply_type_code" WITH =,
		daterange("effective_from", "effective_to", '[)') WITH &&
	) WHERE ("deleted_at" IS NULL)
);--> statement-breakpoint
CREATE TABLE "app_db"."tax_registrations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"jurisdiction_code" text NOT NULL,
	"program" text NOT NULL,
	"components" "app_db"."tax_component"[] NOT NULL,
	"registration_number" text,
	"registered" boolean NOT NULL,
	"is_placeholder" boolean DEFAULT false NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tax_registrations_range_valid" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
	CONSTRAINT "tax_registrations_no_overlap" EXCLUDE USING gist (
		"jurisdiction_code" WITH =,
		"program" WITH =,
		daterange("effective_from", "effective_to", '[)') WITH &&
	) WHERE ("deleted_at" IS NULL)
);--> statement-breakpoint
CREATE TABLE "app_db"."tax_config_audit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entity" text NOT NULL,
	"record_id" text NOT NULL,
	"action" "app_db"."tax_config_audit_action" NOT NULL,
	"actor_user_id" text,
	"reason" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."tax_rates" ADD CONSTRAINT "tax_rates_jurisdiction_code_fk" FOREIGN KEY ("jurisdiction_code") REFERENCES "app_db"."tax_jurisdictions"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."tax_supply_treatments" ADD CONSTRAINT "tax_supply_treatments_supply_type_code_fk" FOREIGN KEY ("supply_type_code") REFERENCES "app_db"."tax_supply_types"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."tax_registrations" ADD CONSTRAINT "tax_registrations_jurisdiction_code_fk" FOREIGN KEY ("jurisdiction_code") REFERENCES "app_db"."tax_jurisdictions"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."tax_config_audit" ADD CONSTRAINT "tax_config_audit_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_rates_jurisdiction_component_idx" ON "app_db"."tax_rates" USING btree ("jurisdiction_code","component");--> statement-breakpoint
CREATE INDEX "tax_supply_treatments_supply_type_idx" ON "app_db"."tax_supply_treatments" USING btree ("supply_type_code");--> statement-breakpoint
CREATE INDEX "tax_registrations_program_idx" ON "app_db"."tax_registrations" USING btree ("jurisdiction_code","program");--> statement-breakpoint
CREATE INDEX "tax_config_audit_record_idx" ON "app_db"."tax_config_audit" USING btree ("entity","record_id");--> statement-breakpoint
-- The audit trail is append-only: refuse UPDATE and DELETE outright.
CREATE FUNCTION "app_db"."tax_config_audit_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'tax_config_audit is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tax_config_audit_no_change" BEFORE UPDATE OR DELETE ON "app_db"."tax_config_audit" FOR EACH ROW EXECUTE FUNCTION "app_db"."tax_config_audit_append_only"();
