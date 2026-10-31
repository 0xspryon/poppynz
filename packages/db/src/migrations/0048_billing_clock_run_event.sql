-- Staging UAT: the event a billing-clock run went up to, structured (its
-- cycle number and date) so the admin web names it in the reader's language;
-- event_label stays the English audit text.
ALTER TABLE "app_db"."billing_clock_runs" ADD COLUMN "event_cycle_number" integer;--> statement-breakpoint
ALTER TABLE "app_db"."billing_clock_runs" ADD COLUMN "event_date" date;
