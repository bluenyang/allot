-- FORCE row-level security for the spec 013 rc.3 tables (same rule as 0010).
ALTER TABLE "schedule_item" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "foreign_currency" FORCE ROW LEVEL SECURITY;
