-- Move the pre-0.1.0-rc.3 hard-wired allocation into data (custom migration).
-- Runs only on a database that has no allocation targets yet. Target names are generic;
-- the user's own names come from their local seed. Display order (seq) follows the old rows.
DO $$
DECLARE
  old_round text;
BEGIN
  -- The old rounding column was renamed to "round_unit" in 0000. A database created before that
  -- rename still has it under its earlier name: find it (the only *_round column besides
  -- sub_round) and rename it, so this migration and 0004 work on both.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'round_unit') THEN
    SELECT column_name INTO old_round FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'settings'
        AND column_name LIKE '%\_round' AND column_name <> 'sub_round';
    IF old_round IS NOT NULL THEN
      EXECUTE format('ALTER TABLE "settings" RENAME COLUMN %I TO "round_unit"', old_round);
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "allocation_target") THEN
    INSERT INTO "allocation_target" ("id", "name", "kind") VALUES
      ('t-living', '생활비', 'living'),
      ('t-subscriptions', '구독 이체', 'subscriptions'),
      ('t-fixed-1', '청약', 'fixed'),
      ('t-fixed-2', '비상금', 'fixed'),
      ('t-fixed-3', '적금', 'fixed'),
      ('t-remainder', '나머지', 'remainder'),
      ('t-fixed-4', '예비', 'fixed');

    INSERT INTO "phase_amount" ("phase_id", "target_id", "amount")
      SELECT "id", 't-fixed-1', "cheongyak" FROM "phase"
      UNION ALL SELECT "id", 't-fixed-2', "cma" FROM "phase"
      UNION ALL SELECT "id", 't-fixed-3', "future" FROM "phase"
      UNION ALL SELECT "id", 't-fixed-4', "reserve" FROM "phase";

    INSERT INTO "remainder_split" ("id", "name", "code", "ratio")
      SELECT "id", "name", "code", "ratio" FROM "isa_split" ORDER BY "seq";

    UPDATE "settings" SET "sub_round" = "round_unit";
  END IF;
END $$;
