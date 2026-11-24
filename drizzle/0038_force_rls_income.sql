-- FORCE row-level security for the spec 014 tables (same rule as 0010).
ALTER TABLE "income_item" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "income_receipt" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "income_extra" FORCE ROW LEVEL SECURITY;
