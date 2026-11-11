ALTER TABLE "living" DROP CONSTRAINT "living_single_row";--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_single_row";--> statement-breakpoint
ALTER TABLE "phase_amount" DROP CONSTRAINT "phase_amount_phase_id_phase_id_fk";
--> statement-breakpoint
ALTER TABLE "phase_amount" DROP CONSTRAINT "phase_amount_target_id_allocation_target_id_fk";
--> statement-breakpoint
ALTER TABLE "plan_change" DROP CONSTRAINT "plan_change_sub_id_subscription_id_fk";
--> statement-breakpoint
DROP INDEX "allocation_target_single_kind";--> statement-breakpoint
ALTER TABLE "allocation_target" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "check_item" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "debt" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "living" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "phase" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "phase_amount" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_change" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_event" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "remainder_split" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_target" ADD CONSTRAINT "allocation_target_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_item" ADD CONSTRAINT "check_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt" ADD CONSTRAINT "debt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "living" ADD CONSTRAINT "living_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase" ADD CONSTRAINT "phase_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_amount" ADD CONSTRAINT "phase_amount_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change" ADD CONSTRAINT "plan_change_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_event" ADD CONSTRAINT "plan_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remainder_split" ADD CONSTRAINT "remainder_split_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_target_single_kind" ON "allocation_target" USING btree ("user_id","kind") WHERE "allocation_target"."kind" <> 'fixed';--> statement-breakpoint
ALTER TABLE "living" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "allocation_target" ADD CONSTRAINT "allocation_target_user_id_id" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_user_id_id" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "check_item" ADD CONSTRAINT "check_item_user_id_id" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "debt" ADD CONSTRAINT "debt_user_id_id" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "phase" ADD CONSTRAINT "phase_user_id_id" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "plan_change" ADD CONSTRAINT "plan_change_user_id_id" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "plan_event" ADD CONSTRAINT "plan_event_user_id_id" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "remainder_split" ADD CONSTRAINT "remainder_split_user_id_id" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_id" UNIQUE("user_id","id");