#!/usr/bin/env bash
# A throwaway PostgreSQL and API for the checks that also write to the database directly — tests/api/mcp.mjs,
# tests/api/api-keys.mjs, tests/api/isolation.mjs (with make-user.ts) — which the read-only test server cannot serve.
# Kept in the repository since retro 0.1.8 (the 0.1.7 harness lived in .loctx and went with the retro; spec 014 A-8).
#
#   bash scripts/test-server/disposable.sh <log-name> <command...>
#   e.g. bash scripts/test-server/disposable.sh mcp-tools node tests/api/mcp.mjs tools
#
# It starts postgres:16 (127.0.0.1 only), creates a role that is not a superuser and its database (row-level
# security applies, as on allot-rc), runs the migrations and creates the admin (`pnpm db:admin`), starts the API of
# this working tree with tsx, waits for /healthz, runs the command with BASE, DATABASE_URL, ADMIN_EMAIL and
# ADMIN_PASSWORD set (after scripts/test-server/seed.mjs puts its fake rows in), and removes the database container and the API at the end, also on a failure. Every
# password and key is random for this run and passed by name only: no value is printed or logged. Nothing touches
# :15173, :15174 or their database. Log: $LOG_DIR/<log-name>.log (check it with `pnpm check:logs`); the API's own
# output: $LOG_DIR/<log-name>.api.log.
set -u
name=${1:?log name}; shift
[ $# -gt 0 ] || { echo "usage: disposable.sh <log-name> <command...>" >&2; exit 2; }
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/common.sh"
. "$ROOT/scripts/check-run.sh"
DB=allot-disp-db
PGPORT=${DISP_PG_PORT:-15183}
APIPORT=${DISP_API_PORT:-15184}
PIDS="$LOG_DIR/${name%.log}.api.pid"
APILOG="$LOG_DIR/${name%.log}.api.log"
rnd() { openssl rand -hex 24; }
export POSTGRES_PASSWORD; POSTGRES_PASSWORD=$(rnd)
export APP_PW; APP_PW=$(rnd)
export PG_SUPER_URL="postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${PGPORT}/postgres"
export DATABASE_URL="postgres://allot_disp:${APP_PW}@127.0.0.1:${PGPORT}/allot_disp"
export BETTER_AUTH_SECRET; BETTER_AUTH_SECRET=$(rnd)
export ALLOT_MASTER_KEY; ALLOT_MASTER_KEY=$(openssl rand -base64 32)
export ADMIN_EMAIL="disp-admin@example.com"
export ADMIN_PASSWORD; ADMIN_PASSWORD="Disp-$(rnd)"
export API_PORT=$APIPORT
export BASE="http://127.0.0.1:${APIPORT}"
export BETTER_AUTH_URL=$BASE

begin "$name" "$LOG_DIR/${name%.log}.log"
step "no earlier container" node "$HERE/no-container.mjs" "$DB"
step "start postgres" docker run -d --rm --name "$DB" -e POSTGRES_PASSWORD -p "127.0.0.1:${PGPORT}:5432" postgres:16.15-alpine3.24
cleanup "remove postgres" docker rm -f "$DB"
step "role and database" node "$HERE/disposable-db.mjs"
step "migrations and admin" pnpm -s db:admin
step "start api" node "$HERE/spawn.mjs" "$PIDS" "$APILOG" pnpm exec tsx server/index.ts
cleanup "stop api" node "$HERE/spawn.mjs" --stop "$PIDS"
step "api answers" node "$HERE/wait.mjs" "$BASE/healthz"
step "seed" node "$HERE/seed.mjs"
step "$name" "$@"
done_check
