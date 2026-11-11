ALTER TABLE "allocation_target" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "check_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "debt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "living" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phase" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phase_amount" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_change" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "remainder_split" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "allot_owner" ON "allocation_target" AS PERMISSIVE FOR ALL TO public USING ("allocation_target"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("allocation_target"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "bank_account" AS PERMISSIVE FOR ALL TO public USING ("bank_account"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("bank_account"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "check_item" AS PERMISSIVE FOR ALL TO public USING ("check_item"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("check_item"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "debt" AS PERMISSIVE FOR ALL TO public USING ("debt"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("debt"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "living" AS PERMISSIVE FOR ALL TO public USING ("living"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("living"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "phase" AS PERMISSIVE FOR ALL TO public USING ("phase"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("phase"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "phase_amount" AS PERMISSIVE FOR ALL TO public USING ("phase_amount"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("phase_amount"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "plan_change" AS PERMISSIVE FOR ALL TO public USING ("plan_change"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("plan_change"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "plan_event" AS PERMISSIVE FOR ALL TO public USING ("plan_event"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("plan_event"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "remainder_split" AS PERMISSIVE FOR ALL TO public USING ("remainder_split"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("remainder_split"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "settings" AS PERMISSIVE FOR ALL TO public USING ("settings"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("settings"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "subscription" AS PERMISSIVE FOR ALL TO public USING ("subscription"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("subscription"."user_id" = current_setting('app.user_id', true));