# Shared by up.sh and run.sh (source it; do not run it). Sets ROOT, LOCTX, LOG_DIR and load_secrets.
#
# .loctx/ is gitignored and lives only in the main checkout, so a linked worktree finds it through
# the git common dir. ALLOT_LOCTX overrides it; LOG_DIR (default $LOCTX/reports/test-server) is where
# evidence logs go.
ROOT=$(git rev-parse --show-toplevel) || exit 1
_common=$(git rev-parse --path-format=absolute --git-common-dir) || exit 1
LOCTX=${ALLOT_LOCTX:-$(dirname "$_common")/.loctx}
LOG_DIR=${LOG_DIR:-$LOCTX/reports/test-server}
HEALTH_URL=http://127.0.0.1:15174/healthz
TEST_BASE=http://127.0.0.1:15174

# load_secrets: the test server's values (AGENTS.md, second exception for .loctx/rc/allot-rc.secrets).
# They are exported by name only; nothing here prints them and no command line carries them.
load_secrets() {
  [ -f "$LOCTX/rc/allot-rc.secrets" ] || { echo "test-server: $LOCTX/rc/allot-rc.secrets is missing" >&2; exit 1; }
  set -a
  . "$LOCTX/rc/allot-rc.secrets"
  set +a
}
