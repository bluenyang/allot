#!/usr/bin/env bash
# Take the throwaway test server down: remove container allot-rc and check that no container of that
# name remains. Run it when the work is released.
#
#   bash scripts/test-server/down.sh
#
# The log goes to $LOG_DIR/down-<time>.log (DOWN_LOG=<file> to choose; an existing log is never
# overwritten) and is checked with `pnpm check:logs`.
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh"
. "$ROOT/scripts/check-run.sh"
begin down "${DOWN_LOG:-$LOG_DIR/down-$(date +%Y%m%dT%H%M%S).log}"
step "remove container" docker rm -f allot-rc
step "no allot-rc remains" sh -c 'n=$(docker ps -a -q -f name=^allot-rc$) || exit 2; [ -z "$n" ] || { echo "container allot-rc still exists: $n"; exit 1; }'
done_check
