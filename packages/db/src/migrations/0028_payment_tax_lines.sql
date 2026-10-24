-- Piece 3: tax lines frozen on every payment, and contract-cycle charges.
--
-- tax_lines: the per-line tax resolved from the tax configuration at quote
--   time (supply type, jurisdiction, component, rate, base, amount, label,
--   registration number). Frozen with the other amounts: a later edit to the
--   configuration never changes an existing charge. tax_cents stays their sum.
-- description: what the payer's history and the provider's receipt call it
--   ("Care with Sam T. · Nov 2–4, 2026"); null falls back to the kind's name.
-- captured_cents: what a hold-then-capture payment actually took (a partial
--   capture releases the rest); null until captured.
-- payments.user_id moves to restrict (umbrella §10: no hard deletes of users
--   with money attached).
ALTER TYPE "app_db"."payment_kind" ADD VALUE IF NOT EXISTS 'contract_cycle';--> statement-breakpoint
ALTER TABLE "app_db"."payments" ADD COLUMN "tax_lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app_db"."payments" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "app_db"."payments" ADD COLUMN "captured_cents" integer;--> statement-breakpoint
ALTER TABLE "app_db"."payments" DROP CONSTRAINT "payments_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "app_db"."payments" ADD CONSTRAINT "payments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;
