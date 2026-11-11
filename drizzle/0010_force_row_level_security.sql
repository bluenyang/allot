-- FORCE: the policies apply to the table owner too (the app connects as the owner).
-- Drizzle cannot express this, so it is the one hand-written statement kind (spec 005, option A).
-- A new owned table needs its line here, in a new custom migration; the server warns at start if one is missing.
ALTER TABLE "settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "living" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_change" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phase" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "check_item" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_account" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "debt" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "allocation_target" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phase_amount" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "remainder_split" FORCE ROW LEVEL SECURITY;
