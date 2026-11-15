-- FORCE row-level security for the spec 007 tables (same rule as 0010).
ALTER TABLE "preference" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "holiday_set" FORCE ROW LEVEL SECURITY;
