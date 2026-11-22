#!/usr/bin/env bash
# Update the staging stack on :15173 (docker/compose.dev.yaml, the user's real data) from the working
# tree, and show what runs. Nothing here writes test data.
#
#   bash scripts/test-server/stage.sh
#
# Steps: compose up (build, new volumes, wait), the running images and the git HEAD they were built
# from, and the front page answering 200. The log goes to $LOG_DIR/stage-<time>.log (STAGE_LOG=<file>
# to choose; an existing log is never overwritten) and is checked with `pnpm check:logs`.
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh"
. "$ROOT/scripts/check-run.sh"
begin stage "${STAGE_LOG:-$LOG_DIR/stage-$(date +%Y%m%dT%H%M%S).log}"
step "compose up" docker compose -f docker/compose.dev.yaml up -d --build -V --wait
step "running images" docker ps --filter label=com.docker.compose.project=allot-dev --format '{{.Names}} {{.Image}} {{.Status}}'
step "git HEAD" git rev-parse HEAD
step "front page answers 200" sh -c 'code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:15173/); echo "http $code"; [ "$code" = 200 ]'
done_check
