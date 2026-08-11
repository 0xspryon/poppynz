CREATE TABLE "app_db"."user_search" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_db"."user_search" ADD CONSTRAINT "user_search_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_search_user_id_idx" ON "app_db"."user_search" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_search_created_at_idx" ON "app_db"."user_search" USING btree ("created_at");
