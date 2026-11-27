ALTER TABLE "settings" ADD COLUMN "month_basis" text DEFAULT 'calendar' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "month_basis_card_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "month_naming" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_month_basis_card_fk" FOREIGN KEY ("user_id","month_basis_card_id") REFERENCES "public"."card"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_month_basis" CHECK ("settings"."month_basis" in ('calendar', 'card', 'pay'));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_month_naming" CHECK ("settings"."month_naming" in ('auto', 'start', 'end'));