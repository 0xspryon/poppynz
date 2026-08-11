-- Scheduled contracts (Flow F): the free-text schedule is replaced by
-- structured per-service sessions inside the services jsonb, the optional end
-- date becomes a negotiated term on the version, and the contract-level
-- ends_on goes away (the notice flow's last working day is derived from
-- end_noticed_at at read time).
ALTER TABLE "app_db"."contract_versions" DROP COLUMN "schedule";--> statement-breakpoint
ALTER TABLE "app_db"."contract_versions" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "app_db"."contracts" DROP COLUMN "ends_on";--> statement-breakpoint
-- Pre-Flow-F service items carried hoursPerWeek and no sessions; normalise
-- them so readers can assume the new shape (dev data only — no production).
UPDATE "app_db"."contract_versions"
SET "services" = (
  SELECT coalesce(jsonb_agg((item - 'hoursPerWeek') || '{"sessions": []}'::jsonb), '[]'::jsonb)
  FROM jsonb_array_elements("services") AS item
)
WHERE "services" <> '[]'::jsonb;
