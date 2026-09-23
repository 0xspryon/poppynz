-- Record what Credibled concluded, not just that it finished.
--
-- Completing an order has always created a verdict in review_required, and
-- that does not change: a person still decides. What changes is that the
-- reviewer no longer has to open the PDF to learn whether the check came back
-- clear. The overall score lands on the order, each check's own score on its
-- item, and both are classified so an adverse result can head the queue.
--
-- Existing completed orders keep null — their scores were never captured, and
-- the report remains the source for them.
CREATE TYPE "app_db"."check_order_outcome" AS ENUM('cleared', 'not_cleared', 'inconclusive');--> statement-breakpoint
ALTER TABLE "app_db"."check_orders"
  ADD COLUMN "outcome" "app_db"."check_order_outcome",
  ADD COLUMN "credibled_score" text;--> statement-breakpoint
ALTER TABLE "app_db"."check_order_items"
  ADD COLUMN "outcome" "app_db"."check_order_outcome",
  ADD COLUMN "credibled_status" text,
  ADD COLUMN "credibled_score" text;
