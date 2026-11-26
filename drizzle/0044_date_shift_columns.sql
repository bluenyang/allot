ALTER TABLE "schedule_item" ADD COLUMN "shift" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "pay_shift" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "transfer_shift" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "billing_shift" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_item" ADD CONSTRAINT "schedule_item_shift" CHECK ("schedule_item"."shift" in ('none', 'before', 'after'));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_pay_shift" CHECK ("settings"."pay_shift" in ('none', 'before', 'after'));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_transfer_shift" CHECK ("settings"."transfer_shift" in ('none', 'before', 'after'));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_billing_shift" CHECK ("settings"."billing_shift" in ('none', 'before', 'after'));