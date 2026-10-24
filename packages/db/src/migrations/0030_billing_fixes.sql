-- Contract billing fix round (2026-10-24).
--
-- payments.released_at: a contract hold Poppynz released without capturing it
--   (helper not ready at capture, the cycle emptied or cancelled). The row
--   stays `failed` for the settle path, but the payer's history shows it as
--   "Not charged" instead of a failed payment.
-- billing_customers.latest_setup_reference: the card setup most recently
--   started for the user. The setup_intent.succeeded webhook may put that
--   setup's card on file over an existing card (it is the one the payer is
--   confirming now); any older setup only fills an empty slot.
ALTER TABLE "app_db"."payments" ADD COLUMN "released_at" timestamp;--> statement-breakpoint
ALTER TABLE "app_db"."billing_customers" ADD COLUMN "latest_setup_reference" text;
