-- Tier 3, step 1b (spec 2026-10-28 §1): a replacement contract started from a
-- helper's cancellation. One row per cancelled session the replacement covers:
-- the replacement contract, the contract it replaces and the session. Rows are
-- written with the replacement's draft and never changed; later steps (money,
-- admin views) read which sessions a replacement stands in for.
CREATE TABLE "app_db"."contract_replacements" (
	"contract_id" uuid NOT NULL,
	"replaces_contract_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_replacements_contract_id_session_id_pk" PRIMARY KEY("contract_id","session_id"),
	CONSTRAINT "contract_replacements_not_self_check" CHECK ("contract_replacements"."contract_id" <> "contract_replacements"."replaces_contract_id")
);--> statement-breakpoint
ALTER TABLE "app_db"."contract_replacements" ADD CONSTRAINT "contract_replacements_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_replacements" ADD CONSTRAINT "contract_replacements_replaces_contract_id_contracts_id_fk" FOREIGN KEY ("replaces_contract_id") REFERENCES "app_db"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."contract_replacements" ADD CONSTRAINT "contract_replacements_session_id_contract_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app_db"."contract_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_replacements_replaces_contract_id_idx" ON "app_db"."contract_replacements" USING btree ("replaces_contract_id");--> statement-breakpoint
CREATE INDEX "contract_replacements_session_id_idx" ON "app_db"."contract_replacements" USING btree ("session_id");
