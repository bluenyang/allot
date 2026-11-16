#!/bin/sh
# check-migrations.sh — migration drift check: the schema must have no change that lacks a migration.
# Runs `pnpm db:generate`; passes only if it says "No schema changes" and drizzle/ is unchanged.
# On drift it prints what changed, removes what it generated (only inside drizzle/) and exits 1.
# Run it through the step runner so the result is evidence:
#   . scripts/check-run.sh
#   begin migrations .loctx/reports/<version>/test/migrations.log
#   step "migration drift" sh scripts/check-migrations.sh
#   done_check
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
out=$(mktemp) || exit 1
trap 'rm -f "$out"' EXIT
before=$(git status --porcelain -- drizzle)
pnpm db:generate > "$out" 2>&1
rc=$?
cat "$out"
after=$(git status --porcelain -- drizzle)
if [ $rc -eq 0 ] && grep -q "No schema changes" "$out" && [ "$before" = "$after" ] && [ -z "$after" ]; then
  echo "check-migrations: ok, no drift"
  exit 0
fi
echo "check-migrations: DRIFT or failure (db:generate exit=$rc); changes in drizzle/:"
git status --porcelain -- drizzle
# Remove only what this run created: untracked files not present before; restore tracked ones.
git status --porcelain -- drizzle | grep '^??' | cut -c4- | while IFS= read -r f; do
  printf '%s\n' "$before" | grep -qxF "?? $f" || rm -rf -- "$f"
done
git checkout -- drizzle
exit 1
