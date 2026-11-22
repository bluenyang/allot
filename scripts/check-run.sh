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
# Each step is one block of metadata lines (never starting with ">"): "=== step: <name>",
# "rev <full HEAD>[+uncommitted]", "date", "$ <command as run>", the output with every line prefixed
# "> " (">" if empty; captured by redirection to a file, never a pipe), "exit=<code of the command
# itself>" and the terminator "=== end". The first non-zero step stops the run with that code.
# A step with a '|' in any argument, or whose command is not an external program (a function or
# builtin loses errexit), is refused (logged, exit=2). A failing runner write ends the run with 70.
# begin refuses a log file that already exists (exit 64, the file stays byte-identical).
# A failed cleanup never hides an earlier failure and turns a passing run into exit 1.
# Verify a log with: pnpm check:logs <log>
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
_TMP=$(mktemp -d) || exit 1
LOG=/dev/null
CLEANUPS=()
CHECK=

_cr_rev() { # prints the rev line's value; returns non-zero if git fails
  local r st
  r=$(git rev-parse HEAD) || return 1
  st=$(git status --porcelain) || return 1
  [ -z "$st" ] || r="$r+uncommitted"
  printf '%s\n' "$r"
}
_cr_q() { # quote one word for the command line shown in the log (bash builtin, no external tool)
  printf '%q' "$1"
}
# A failure of the runner's own writes ends the run with 70; the block is left without exit= and "=== end".
# printf, never echo: echo's behaviour depends on the caller's shell options (xpg_echo).
_cr_say() { printf '%s\n' "$@"; }
_cr_die() { _cr_say "runner error: $1" >> "$LOG" 2>/dev/null; _cr_say "check-run: runner error: $1" >&2; exit 70; }
_cr_has_pipe() { local a; for a in "$@"; do case $a in *'|'*) return 0 ;; esac; done; return 1; }
_cr_run() { # kind name command...
  local kind=$1 name=$2 out rc a; shift 2
  out=$(mktemp "$_TMP/step.XXXXXX") || _cr_die "create the capture file"
  local rev now cmd=''
  rev=$(_cr_rev) || _cr_die "read the git rev"
  now=$(date -Is) || _cr_die "read the date"
  for a in "$@"; do cmd+=" $(_cr_q "$a")" || _cr_die "quote the command"; done
  { _cr_say "=== $kind: $name"; _cr_say "rev $rev"; _cr_say "date $now"; _cr_say "\$$cmd"; } >> "$LOG" || _cr_die "write the block header"
  if _cr_has_pipe "$@"; then
    _cr_say "check-run: refused, an argument contains '|'; a pipe hides the exit code. Use redirection to a file." > "$out" || _cr_die "write the capture file"
    rc=2
  elif [ "$(type -t "$1")" != file ]; then
    _cr_say "check-run: refused, '$1' is not an external command (functions and builtins lose errexit and can hide failures). Use /usr/bin/env or bash -c." > "$out" || _cr_die "write the capture file"
    rc=2
  elif "$@" > "$out" 2>&1; then rc=0; else rc=$?; fi
  # every output line is written as "> <line>" (">" if empty), so output can never look like metadata
  sed -e 's/^\(.\)/> \1/' -e 's/^$/>/' "$out" >> "$LOG" || _cr_die "frame the output (sed)"
  if [ -s "$out" ] && [ -n "$(tail -c 1 "$out")" ]; then
    { _cr_say ''; _cr_say "> [the output above had no newline at its end]"; } >> "$LOG" || _cr_die "write the output note"
  fi
  rm -f "$out"
  { _cr_say "exit=$rc"; _cr_say "=== end"; _cr_say ''; } >> "$LOG" || _cr_die "write the block footer"
  _cr_say "[$CHECK] $kind $name: exit=$rc"
  return $rc
}
# begin <check> <logfile>: start a check's log. An existing log is never overwritten (a failed run's
# original must survive a later run): the runner stops with 64 before anything runs, and the existing
# file is not touched. Pick a new name.
begin() {
  CHECK=$1
  if [ -e "$2" ] || [ -L "$2" ]; then
    _cr_say "check-run: refused, the log '$2' already exists. Pick a new log name; a log is never overwritten." >&2
    exit 64
  fi
  LOG=$2
  mkdir -p "$(dirname "$LOG")"
  { _cr_say "# check $CHECK, started $(date -Is)"; _cr_say ''; } > "$LOG"
}
# step <name> <command...>: run; stop everything on non-zero.
step() {
  local rc
  if _cr_run step "$@"; then rc=0; else rc=$?; fi
  if [ $rc -ne 0 ]; then _cr_say "STOPPED at step '$1' (exit=$rc)" >> "$LOG"; exit $rc; fi
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
  if ! _cr_cleanups; then _cr_say "RESULT $CHECK: fail (a cleanup failed)" >> "$LOG"; exit 1; fi
  _cr_say "RESULT $CHECK: all steps exit 0" >> "$LOG"
}
_cr_on_exit() {
  local rc=$?
  if [ ${#CLEANUPS[@]} -gt 0 ]; then _cr_cleanups || { [ $rc -eq 0 ] && rc=1; }; fi
  if [ $rc -ne 0 ]; then _cr_say "RESULT $CHECK: fail (exit=$rc)" >> "$LOG"; fi
  rm -rf "$_TMP"
  exit $rc
}
trap _cr_on_exit EXIT
