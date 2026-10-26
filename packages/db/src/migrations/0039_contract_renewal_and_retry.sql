-- UAT round 2 (contracts and billing).
--
-- 7b: "Start a new contract from this one" opens a new draft in the same
-- conversation while the old contract is still active, ending or ended. A
-- conversation may therefore hold several contracts over time, but still only
-- ONE that is being negotiated (draft, proposed, changes requested or
-- declined — a declined contract can be revised and re-sent).
DROP INDEX IF EXISTS "app_db"."contracts_conversation_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_conversation_negotiating_uidx" ON "app_db"."contracts" USING btree ("conversation_id") WHERE "deleted_at" is null AND "status" IN ('draft', 'proposed', 'changes_requested', 'declined');--> statement-breakpoint
CREATE INDEX "contracts_conversation_id_idx" ON "app_db"."contracts" USING btree ("conversation_id");--> statement-breakpoint
-- 13: the family's "Retry payment" is rate-limited per contract. The claim is
-- a single compare-and-set on this column, so a double click or two tabs can
-- never start two retries at once.
ALTER TABLE "app_db"."contract_billing" ADD COLUMN "family_retry_at" timestamp;
