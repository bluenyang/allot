-- FORCE row-level security for the change-set tables (same rule as 0010).
ALTER TABLE "change_set" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "change_log" FORCE ROW LEVEL SECURITY;
