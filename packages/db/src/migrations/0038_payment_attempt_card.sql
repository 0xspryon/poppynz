-- Round 3 billing fixes (R4): an off-session contract attempt is frozen at
-- creation — the card it charges and the idempotency key it is sent under —
-- so a retry or replay is always the same request, even after the family
-- replaces the card (a changed card under the same key is refused by the
-- provider forever). Nullable: check-order payments and rows created before
-- this migration have neither.
ALTER TABLE "app_db"."payments" ADD COLUMN "card_reference" text;--> statement-breakpoint
ALTER TABLE "app_db"."payments" ADD COLUMN "charge_key" text;
