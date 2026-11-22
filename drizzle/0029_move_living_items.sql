-- Spec 013 S-2: the three living values (food, transit, allowance) become three living items of the
-- same amounts, per user, named in the user's language (en → English, otherwise Korean). A value of 0
-- is moved too, so the living sum stays exactly what it was. Row-level security is forced on these
-- tables, so each user's rows are read and written as that user (app.user_id), as the API does.
-- Also FORCE row-level security on the spec 013 tables (same rule as 0010).
DO $$
DECLARE
  u record;
  en boolean;
BEGIN
  FOR u IN SELECT "id" FROM "user" LOOP
    PERFORM set_config('app.user_id', u."id", true);
    SELECT coalesce((SELECT "language" = 'en' FROM "preference" WHERE "user_id" = u."id"), false) INTO en;
    INSERT INTO "living_item" ("user_id", "id", "name", "kind", "amount", "code")
    SELECT l."user_id", gen_random_uuid()::text, v.name, v.name, v.amount, v.code
    FROM "living" l
    CROSS JOIN LATERAL (VALUES
      (1, CASE WHEN en THEN 'Food' ELSE '식비' END, l."food", 'food'),
      (2, CASE WHEN en THEN 'Transport' ELSE '교통' END, l."transit", 'transit'),
      (3, CASE WHEN en THEN 'Allowance' ELSE '용돈' END, l."allowance", 'allowance')
    ) AS v(ord, name, amount, code)
    WHERE l."user_id" = u."id"
      AND NOT EXISTS (SELECT 1 FROM "living_item" i WHERE i."user_id" = u."id" AND i."code" = v.code)
    ORDER BY v.ord;
  END LOOP;
  PERFORM set_config('app.user_id', '', true);
END $$;--> statement-breakpoint
ALTER TABLE "living_item" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "living_phase_amount" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_balance" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_phase_amount" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "card" FORCE ROW LEVEL SECURITY;
