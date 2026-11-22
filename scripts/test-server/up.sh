#!/usr/bin/env bash
# (Re)start the throwaway test server: container allot-rc on :15174, on the dev compose network, with
# its own database (allot_rc). It runs `allot:test` built from the working tree, or the image given.
#
#   bash scripts/test-server/up.sh [image]       (or IMAGE=<image>)
#
# Values come from .loctx/rc/allot-rc.secrets and are passed to the container by NAME only
# (`docker run -e NAME`), never on a command line or in a log. Needs the dev stack's db
# (docker/compose.dev.yaml) running. The log goes to $LOG_DIR/up-<time>.log (LOG=<file> to choose;
# an existing log is never overwritten) and is checked with `pnpm check:logs`.
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh"
IMAGE=${1:-${IMAGE:-}}
. "$ROOT/scripts/check-run.sh"
load_secrets
export DATABASE_URL="postgres://allot_keys:${ALLOT_RC_DB_PASSWORD}@db:5432/allot_rc"
export BETTER_AUTH_URL=$TEST_BASE
begin up "${UP_LOG:-$LOG_DIR/up-$(date +%Y%m%dT%H%M%S).log}"
[ -n "$IMAGE" ] || step "build image" docker build -q -t allot:test .
step "remove old" docker rm -f allot-rc
step "run" docker run -d --name allot-rc --network allot-dev_default --read-only --tmpfs /tmp -p 15174:3000 -e DATABASE_URL -e BETTER_AUTH_SECRET -e ALLOT_MASTER_KEY -e ADMIN_EMAIL -e BETTER_AUTH_URL "${IMAGE:-allot:test}"
step "wait healthy" node "$HERE/wait.mjs" "$HEALTH_URL"
step "state" docker inspect -f "{{.State.Status}} {{.Config.Image}}" allot-rc
done_check
