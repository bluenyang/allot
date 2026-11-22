# Throwaway test server scripts

Helpers for the throwaway test server: container `allot-rc` on **:15174**, on the dev compose
network, with its own database (`allot_rc`). Every E2E, API check and screen check runs there, never
on :15173 (the staging stack that holds real data). All scripts refuse any other server.

Needs: the dev stack's database running (`docker/compose.dev.yaml`), and the test server's values in
`.loctx/rc/allot-rc.secrets` (gitignored, in the main checkout; found from a linked worktree too).
The values are passed by name only (`docker run -e NAME`, `source`); nothing prints them.

| Script | What |
|---|---|
| `up.sh [image]` | (Re)start `allot-rc` from `allot:test` (built from the working tree) or the given image; waits for `/healthz`. Log: `$LOG_DIR/up-<time>.log` (`UP_LOG=<file>` to choose). |
| `cleanup.mjs` | Delete rows whose name starts with `E2E-`, `V8-marker`, `V5-marker` or `V4-fixture` from every list of the test account. |
| `seed.mjs` | Create fake data the E2E assume if it is missing (settings, living costs, one target of each kind, a subscription with a plan change, an open phase covering this month, a check item). Names start with `Seed `. Run twice, it changes nothing the second time. |
| `run.sh <log-name> <command...>` | Load the test account by name, set `BASE`, wait for the login limit (`WAIT`, default 70 s), then run the command through `scripts/check-run.sh` into `$LOG_DIR/<log-name>.log`. |

`LOG_DIR` defaults to `.loctx/reports/test-server`. `check-run.sh` never overwrites a log: a name that
exists is refused (exit 64), so choose a new one. Check a log with `pnpm check:logs <file>`.

```bash
bash scripts/test-server/up.sh
bash scripts/test-server/run.sh clean-1 node scripts/test-server/cleanup.mjs
bash scripts/test-server/run.sh seed-1 node scripts/test-server/seed.mjs
bash scripts/test-server/run.sh e2e-edit pnpm exec playwright test tests/e2e/edit.spec.ts
docker rm -f allot-rc            # take it down when the work is released
```

`cleanup.mjs` and `seed.mjs` sign in once each, and the login limit is 5 per minute: set `WAIT=0` only
for a few quick runs in a row. A test account without data makes tests fail for lack of data, not for
a bug: run `seed.mjs` first. Leftover `E2E-` rows from an interrupted run do the same: run `cleanup.mjs`.
