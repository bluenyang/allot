-- FORCE row-level security for the spec 011 tables (same rule as 0010).
ALTER TABLE "spending" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spending_round" FORCE ROW LEVEL SECURITY;
