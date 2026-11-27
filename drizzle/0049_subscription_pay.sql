ALTER TABLE "subscription" ADD COLUMN "card_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_card_fk" FOREIGN KEY ("user_id","card_id") REFERENCES "public"."card"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."bank_account"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_pay_one_of" CHECK ("subscription"."card_id" is null or "subscription"."account_id" is null);