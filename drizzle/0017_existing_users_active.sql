-- Accounts that exist before 0.1.2 keep working (custom migration, spec 006 W-4).
-- 0016 added status with the closed default 'pending'; every row there now is an existing
-- account: make it active, admitted by the seed. If there is no admin and exactly one account,
-- that account is the admin (the 0.1.1 install has one login account). With more accounts and
-- no admin, nobody is guessed: ADMIN_EMAIL makes its account the admin when the app starts.
UPDATE "user" SET "status" = 'active', "admission" = 'seed';--> statement-breakpoint
UPDATE "user" SET "role" = 'admin'
WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE "role" = 'admin')
  AND (SELECT count(*) FROM "user") = 1;
