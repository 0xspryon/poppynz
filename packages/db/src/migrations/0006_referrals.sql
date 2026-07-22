CREATE TABLE "app_db"."referral" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"referrer_user_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"referred_user_id" text,
	"expires_at" timestamp NOT NULL,
	"joined_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_db"."referral" ADD CONSTRAINT "referral_referrer_user_id_user_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."referral" ADD CONSTRAINT "referral_referred_user_id_user_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "app_db"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referral_referrer_user_id_idx" ON "app_db"."referral" USING btree ("referrer_user_id");--> statement-breakpoint
CREATE INDEX "referral_email_idx" ON "app_db"."referral" USING btree ("email");
