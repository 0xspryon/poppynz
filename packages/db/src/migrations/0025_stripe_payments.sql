-- Stripe card payments (piece 2a of the contract-billing design).
--
-- billing_customers: a paying user's customer at the gateway and the one card
--   kept on file (families only). Card columns are display copies — the card
--   itself never leaves the gateway.
-- payments.receipt_url: the gateway's receipt page for a captured charge,
--   shown in the family's payment history.
-- stripe_webhook_events: one row per accepted delivery, for de-duplication
--   (Stripe delivers at least once) and audit. The payload is not stored;
--   handlers re-fetch from Stripe.
--
-- Every new foreign key is `restrict`.

CREATE TABLE "app_db"."billing_customers" (
  "user_id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "customer_reference" text NOT NULL,
  "card_reference" text,
  "card_brand" text,
  "card_last4" text,
  "card_exp_month" integer,
  "card_exp_year" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."billing_customers"
  ADD CONSTRAINT "billing_customers_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_provider_customer_uidx"
  ON "app_db"."billing_customers" ("provider", "customer_reference");--> statement-breakpoint

ALTER TABLE "app_db"."payments" ADD COLUMN "receipt_url" text;--> statement-breakpoint
-- The recovery job's scan: charges still waiting on the provider.
CREATE INDEX "payments_pending_created_at_idx"
  ON "app_db"."payments" ("created_at")
  WHERE "status" = 'pending' AND "provider_reference" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "app_db"."stripe_webhook_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "object_id" text NOT NULL,
  "received_at" timestamp DEFAULT now() NOT NULL,
  "processed_at" timestamp,
  "error" text
);--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_received_at_idx"
  ON "app_db"."stripe_webhook_events" ("received_at");
