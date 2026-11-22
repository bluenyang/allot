#!/usr/bin/env bash
# Run one command against the throwaway test server (:15174) as evidence: the command goes through
# scripts/check-run.sh into $LOG_DIR/<log-name>.log (LOG_DIR default: .loctx/reports/test-server).
#
#   bash scripts/test-server/run.sh <log-name> <command...>
#   bash scripts/test-server/run.sh e2e-edit pnpm exec playwright test tests/e2e/edit.spec.ts
#   bash scripts/test-server/run.sh clean node scripts/test-server/cleanup.mjs
#
# The test account (ADMIN_EMAIL, ADMIN_PASSWORD) is loaded from .loctx/rc/allot-rc.secrets by name;
# the server's own secrets are unset again before the command runs. BASE is set to the test server.
# The runner waits first for the login limit (WAIT seconds, default 70; WAIT=0 skips it when the
# run signs in at most a few times per minute). A log that already exists is refused: pick a new name.
set -u
name=${1:?log name}; shift
[ $# -gt 0 ] || { echo "usage: run.sh <log-name> <command...>" >&2; exit 2; }
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh"
. "$ROOT/scripts/check-run.sh"
load_secrets
unset ALLOT_RC_DB_PASSWORD BETTER_AUTH_SECRET ALLOT_MASTER_KEY
export BASE=$TEST_BASE
begin "$name" "$LOG_DIR/${name%.log}.log"
step "base is the test server" node -e "process.exit(process.env.BASE==='$TEST_BASE'?0:1)"
step "pause for the login limit" node -e "setTimeout(()=>{},${WAIT:-70}*1000)"
step "$name" "$@"
done_check
