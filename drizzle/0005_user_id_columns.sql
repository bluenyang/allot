ALTER TABLE "allocation_target" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "check_item" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "debt" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "living" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "phase_amount" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "plan_change" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "plan_event" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "remainder_split" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "user_id" text;