-- UAT #3: the app ships in English and French only. The old toggle stored
-- 'es' (never translated); every value other than 'en'/'fr' becomes 'en'.
-- Data-only: the column stays free text, the api validates en/fr.
UPDATE "app_db"."user_profile" SET "language" = 'en'
  WHERE "language" NOT IN ('en', 'fr');--> statement-breakpoint
UPDATE "app_db"."signup_intent" SET "language" = 'en'
  WHERE "language" NOT IN ('en', 'fr');
