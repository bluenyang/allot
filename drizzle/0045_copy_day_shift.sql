-- Spec 018 S-1, S-11: the one weekend and holiday rule of a user (settings.day_shift) becomes the rule of each of
-- that user's dates — the pay day, the transfer day, the card billing day and every schedule item of their own — so
-- no date moves with this upgrade. Row-level security is forced on both tables, so each user's rows are read and
-- written as that user (app.user_id), as the API does and as 0029 did. Every row of these tables has an owner in
-- "user" (user_id is a foreign key to it), so the loop reaches every row. A settings row left with a rule that
-- differs from day_shift, or a schedule item that differs from its owner's, stops the migration.
DO $$
DECLARE
  u record;
  left_over integer;
BEGIN
  FOR u IN SELECT "id" FROM "user" LOOP
    PERFORM set_config('app.user_id', u."id", true);
    UPDATE "settings"
    SET "pay_shift" = "day_shift", "transfer_shift" = "day_shift", "billing_shift" = "day_shift"
    WHERE "user_id" = u."id";
    UPDATE "schedule_item" i
    SET "shift" = s."day_shift"
    FROM "settings" s
    WHERE i."user_id" = u."id" AND s."user_id" = u."id";
    SELECT count(*) INTO left_over FROM (
      SELECT 1 FROM "settings" s
      WHERE s."user_id" = u."id"
        AND (s."pay_shift" <> s."day_shift" OR s."transfer_shift" <> s."day_shift" OR s."billing_shift" <> s."day_shift")
      UNION ALL
      SELECT 1 FROM "schedule_item" i JOIN "settings" s ON s."user_id" = i."user_id"
      WHERE i."user_id" = u."id" AND i."shift" <> s."day_shift"
    ) x;
    IF left_over > 0 THEN
      RAISE EXCEPTION 'copy_day_shift: % row(s) of one user were not copied', left_over;
    END IF;
  END LOOP;
  PERFORM set_config('app.user_id', '', true);
END $$;
