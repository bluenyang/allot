# check-run.sh — step runner for checks whose log is evidence. Source it from bash:
#
#   #!/usr/bin/env bash
#   . scripts/check-run.sh
#   begin v1 .loctx/reports/<version>/test/v1.log
#   step "typecheck" pnpm typecheck
#   step "migrations" sh scripts/check-migrations.sh
#   cleanup "remove temp" rm -rf /tmp/x      # runs in reverse order at done_check or on exit
#   done_check
#
# Each step logs "=== step: <name>", "rev <full HEAD>[+uncommitted]", "date", "$ <command as run>",
# the full output (captured by redirection to a file, never a pipe), a newline if the output lacked
# one, and "exit=<code of the command itself>". The first non-zero step stops the run with that code.
# A step with a '|' in any argument is refused (logged, exit=2): pipes and sh -c pipelines hide exit codes.
# A failed cleanup never hides an earlier failure and turns a passing run into exit 1.
# Verify a log with: pnpm check:logs <log>
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
_TMP=$(mktemp -d) || exit 1
LOG=/dev/null
CLEANUPS=()
CHECK=

_cr_rev() { local r; r=$(git rev-parse HEAD); [ -z "$(git status --porcelain)" ] || r="$r+uncommitted"; echo "$r"; }
_cr_q() { # quote one word for the command line shown in the log
  case $1 in
    ''|*[!A-Za-z0-9_./=:,@%+-]*) printf "'%s'" "$(printf %s "$1" | sed "s/'/'\\\\''/g")" ;;
    *) printf %s "$1" ;;
  esac
}
_cr_has_pipe() { local a; for a in "$@"; do case $a in *'|'*) return 0 ;; esac; done; return 1; }
_cr_run() { # kind name command...
  local kind=$1 name=$2 out rc a; shift 2
  out=$(mktemp "$_TMP/step.XXXXXX")
  { echo "=== $kind: $name"; echo "rev $(_cr_rev)"; echo "date $(date -Is)"
    printf '$'; for a in "$@"; do printf ' '; _cr_q "$a"; done; echo; } >> "$LOG"
  if _cr_has_pipe "$@"; then
    echo "check-run: refused, an argument contains '|'; a pipe hides the exit code. Use redirection to a file." > "$out"
    rc=2
  elif "$@" > "$out" 2>&1; then rc=0; else rc=$?; fi
  cat "$out" >> "$LOG"
  if [ -s "$out" ] && [ -n "$(tail -c 1 "$out")" ]; then
    { echo; echo "[the output above had no newline at its end]"; } >> "$LOG"
  fi
  rm -f "$out"
  { echo "exit=$rc"; echo; } >> "$LOG"
  echo "[$CHECK] $kind $name: exit=$rc"
  return $rc
}
# begin <check> <logfile>: start a check's log.
begin() {
  CHECK=$1; LOG=$2
  mkdir -p "$(dirname "$LOG")"
  { echo "# check $CHECK, started $(date -Is)"; echo; } > "$LOG"
}
# step <name> <command...>: run; stop everything on non-zero.
step() {
  local rc
  if _cr_run step "$@"; then rc=0; else rc=$?; fi
  if [ $rc -ne 0 ]; then echo "STOPPED at step '$1' (exit=$rc)" >> "$LOG"; exit $rc; fi
}
# cleanup <name> <command...>: registered now, run in reverse order at done_check or on exit.
cleanup() { CLEANUPS+=("$(printf '%q ' "$@")"); }
_cr_cleanups() { # returns 1 if any cleanup failed
  local i bad=0
  for ((i=${#CLEANUPS[@]}-1; i>=0; i--)); do
    if ! eval "_cr_run cleanup ${CLEANUPS[$i]}"; then bad=1; fi
  done
  CLEANUPS=(); return $bad
}
# done_check: run the cleanups and write the verdict.
done_check() {
  if ! _cr_cleanups; then echo "RESULT $CHECK: fail (a cleanup failed)" >> "$LOG"; exit 1; fi
  echo "RESULT $CHECK: all steps exit 0" >> "$LOG"
}
_cr_on_exit() {
  local rc=$?
  if [ ${#CLEANUPS[@]} -gt 0 ]; then _cr_cleanups || { [ $rc -eq 0 ] && rc=1; }; fi
  if [ $rc -ne 0 ]; then echo "RESULT $CHECK: fail (exit=$rc)" >> "$LOG"; fi
  rm -rf "$_TMP"
  exit $rc
}
trap _cr_on_exit EXIT
