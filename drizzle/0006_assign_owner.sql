-- Give every existing row an owner (custom migration, 0.1.1).
-- Rows exist and exactly one login account exists: that account owns them all.
-- Rows exist but there are no accounts, or more than one: stop with the reason; nothing is guessed.
-- No rows: nothing to do (a new database).
DO $$
DECLARE
  n_rows bigint;
  n_users bigint;
  owner_id text;
BEGIN
  SELECT (SELECT count(*) FROM "settings") + (SELECT count(*) FROM "living") + (SELECT count(*) FROM "subscription")
       + (SELECT count(*) FROM "plan_change") + (SELECT count(*) FROM "phase") + (SELECT count(*) FROM "plan_event")
       + (SELECT count(*) FROM "check_item") + (SELECT count(*) FROM "bank_account") + (SELECT count(*) FROM "debt")
       + (SELECT count(*) FROM "allocation_target") + (SELECT count(*) FROM "phase_amount") + (SELECT count(*) FROM "remainder_split")
    INTO n_rows;
  IF n_rows = 0 THEN
    RETURN;
  END IF;
  SELECT count(*) INTO n_users FROM "user";
  IF n_users <> 1 THEN
    RAISE EXCEPTION 'allot 0.1.1: % data rows need an owner, but there are % login accounts (need exactly 1). Remove the extra accounts or run the seed first, then start again.', n_rows, n_users;
  END IF;
  SELECT "id" INTO owner_id FROM "user";
  UPDATE "settings" SET "user_id" = owner_id;
  UPDATE "living" SET "user_id" = owner_id;
  UPDATE "subscription" SET "user_id" = owner_id;
  UPDATE "plan_change" SET "user_id" = owner_id;
  UPDATE "phase" SET "user_id" = owner_id;
  UPDATE "plan_event" SET "user_id" = owner_id;
  UPDATE "check_item" SET "user_id" = owner_id;
  UPDATE "bank_account" SET "user_id" = owner_id;
  UPDATE "debt" SET "user_id" = owner_id;
  UPDATE "allocation_target" SET "user_id" = owner_id;
  UPDATE "phase_amount" SET "user_id" = owner_id;
  UPDATE "remainder_split" SET "user_id" = owner_id;
END $$;
