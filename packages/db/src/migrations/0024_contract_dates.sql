-- Contract dates follow the family's own time zone, not Pacific/Auckland.
--
-- time_zone: IANA name taken from the family's location when the terms are
-- sent, frozen when the version is accepted (accepted versions are never
-- edited). Null only while a version is a draft.
-- ends_at_minutes: optional last-day end time for a negotiated end date,
-- wall-clock minutes 1..1440 in time_zone; sessions that day are cut at it.
ALTER TABLE "app_db"."contract_versions"
  ADD COLUMN "time_zone" text,
  ADD COLUMN "ends_at_minutes" integer;--> statement-breakpoint
-- Development data only (nothing exists in staging or production): give every
-- sent version a zone so the check below holds.
UPDATE "app_db"."contract_versions"
  SET "time_zone" = 'America/Winnipeg'
  WHERE "status" <> 'draft' AND "time_zone" IS NULL;--> statement-breakpoint
ALTER TABLE "app_db"."contract_versions"
  ADD CONSTRAINT "contract_versions_time_zone_when_sent"
    CHECK ("status" = 'draft' OR "time_zone" IS NOT NULL),
  ADD CONSTRAINT "contract_versions_ends_at_minutes_valid"
    CHECK ("ends_at_minutes" IS NULL
           OR ("ends_on" IS NOT NULL AND "ends_at_minutes" BETWEEN 1 AND 1440));
