#!/usr/bin/env bash
# Update the staging stack on :15173 (docker/compose.dev.yaml, the user's real data) to a BUILT snapshot of one commit,
# run with node — not the working tree (retro 0.1.7, user: "빌드해서 노드로 올려두는 식으로"). Nothing here writes test data.
#
#   bash scripts/test-server/stage.sh [<commit>]        (default: origin/master after a fetch)
#
# Steps: resolve the commit; unless .loctx/staging/<sha>/ is built already, `git archive` it there and build it inside
# the dev api image (pnpm install --ignore-scripts, vite build, build:server; the pnpm store in a named volume); back
# up the database (.loctx/backup/, mode 600); point .loctx/staging/current at the snapshot; recreate api and web
# (compose output discarded through quiet.mjs: it could hold env values; only the exit is logged); show what runs,
# the staged commit, /healthz and the front page answering 200; keep the current and the previous snapshot only.
# It refuses a commit that is not a descendant of the one staged now (the database may hold its migrations) unless
# STAGE_BACK=1. The log goes to $LOG_DIR/stage-<time>.log (STAGE_LOG=<file> to choose; never overwritten), checked with
# `pnpm check:logs`. Run it from the main checkout (compose resolves the snapshot mount next to docker/).
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh"
. "$ROOT/scripts/check-run.sh"
REF=${1:-}
if [ -z "$REF" ]; then git -C "$ROOT" fetch -q origin master || exit 1; REF=origin/master; fi
SHA=$(git -C "$ROOT" rev-parse --verify "${REF}^{commit}") || { echo "stage: not a commit: $REF" >&2; exit 1; }
# compose mounts ../.loctx/staging/current relative to the compose file it is given: run from the main checkout,
# whose .loctx is the common one (a linked worktree's own .loctx holds no snapshot)
[ "$ROOT/.loctx" -ef "$LOCTX" ] || { echo "stage: run from the main checkout ($LOCTX), not a linked worktree" >&2; exit 1; }
# Snapshots hold node_modules: they live outside the folder Syncthing syncs (.stignore keeps .loctx), and
# .loctx/staging is a link to them (Syncthing syncs a link, not what it points at; compose follows it).
ST=$LOCTX/staging
STORE=${XDG_DATA_HOME:-$HOME/.local/share}/allot/staging
mkdir -p "$STORE" || exit 1
[ -L "$ST" ] || [ ! -e "$ST" ] || { echo "stage: $ST exists and is not a link to $STORE; move it away first" >&2; exit 1; }
[ -L "$ST" ] || ln -s "$STORE" "$ST" || exit 1
SNAP=$ST/$SHA
STAMP=$(date +%Y%m%dT%H%M%S)
mkdir -p "$LOCTX/backup" || exit 1
PREV=$(readlink "$ST/current" 2>/dev/null || true)
begin stage "${STAGE_LOG:-$LOG_DIR/stage-$STAMP.log}"
step "commit" git -C "$ROOT" log -1 --format=%H%n%s "$SHA"
# Never back by surprise (retro review S-1): the database may already hold the newer commit's migrations.
if [ -n "$PREV" ] && [ "$PREV" != "$SHA" ]; then
  step "previously staged" git -C "$ROOT" log -1 --format=%H%n%s "$PREV"
  if ! git -C "$ROOT" merge-base --is-ancestor "$PREV" "$SHA" && [ "${STAGE_BACK:-}" != 1 ]; then
    step "the new commit is not after the staged one (set STAGE_BACK=1 to go back on purpose)" /usr/bin/false
  fi
fi
if [ ! -f "$SNAP/dist-server/index.mjs" ] || [ ! -f "$SNAP/dist/index.html" ]; then
  step "clear a half-built snapshot" rm -rf "$SNAP" "$ST/$SHA.tar"
  step "archive the commit" git -C "$ROOT" archive -o "$ST/$SHA.tar" "$SHA"
  step "unpack" mkdir "$SNAP"
  step "unpack files" tar -xf "$ST/$SHA.tar" -C "$SNAP"
  step "remove the archive" rm "$ST/$SHA.tar"
  step "build in the dev image" docker run --rm -v "$SNAP:/w" -v allot-stage-pnpm-store:/pnpm-store -w /w allot-dev-api sh -c "pnpm config set store-dir /pnpm-store --location project && pnpm install --frozen-lockfile --ignore-scripts && pnpm build && pnpm build:server && chown -R $(id -u):$(id -g) /w"
fi
step "snapshot is built" /usr/bin/test -f "$SNAP/dist-server/index.mjs" -a -f "$SNAP/dist/index.html"
step "back up the database" node "$HERE/backup.mjs" "$LOCTX/backup/allot-dev-before-stage-${SHA:0:7}-$STAMP.sql"
# an empty folder docker made for a mount before the first switch is not a link: remove it (rmdir refuses a full one)
[ -d "$ST/current" ] && [ ! -L "$ST/current" ] && step "remove the empty mount folder docker made" rmdir "$ST/current"
step "point current at the snapshot" ln -sfn "$SHA" "$ST/current"
step "recreate api and web" node "$HERE/quiet.mjs" docker compose --progress quiet -f "$ROOT/docker/compose.dev.yaml" up -d --force-recreate --wait api web
step "running images" docker ps --filter label=com.docker.compose.project=allot-dev --format '{{.Names}} {{.Image}} {{.Status}}'
step "staged commit" readlink "$ST/current"
step "api answers /healthz" docker exec allot-dev-api-1 wget -qO- http://127.0.0.1:3000/healthz
step "front page answers 200" sh -c 'code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:15173/); echo "http $code"; [ "$code" = 200 ]'
# keep the served snapshot and the newest other one (the rollback), also when the same commit was staged again
KEEP=$(ls -1t "$STORE" | grep -v -x -e current -e "$SHA" -e '[0-9a-f]*\.tar' | head -1)
for d in "$STORE"/*/; do
  n=$(basename "$d")
  { [ "$n" = current ] || [ "$n" = "$SHA" ] || [ "$n" = "$KEEP" ]; } && continue
  step "remove an older snapshot" rm -rf "$STORE/$n"
done
done_check
