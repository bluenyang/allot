# Throwaway test server scripts

Helpers for the throwaway test server: container `allot-rc` on **:15174**, on the dev compose
network, with its own database (`allot_rc`). Every E2E, API check and screen check runs there, never
on :15173 (the staging stack that holds real data). All scripts refuse any other server.

Needs: the dev stack's database running (`docker/compose.dev.yaml`), and the test server's values in
`.loctx/rc/allot-rc.secrets` (gitignored, in the main checkout; found from a linked worktree too).
The values are passed by name only (`docker run -e NAME`, `source`); nothing prints them.

| Script | What |
|---|---|
| `up.sh [image]` | (Re)start `allot-rc` from `allot:test` (built from the working tree) or the given image; waits for `/healthz`. Log: `$LOG_DIR/up-<time>.log` (`UP_LOG=<file>` to choose). `ALLOT_FX_URL` / `ALLOT_FX_REFRESH`, when set, are passed to the container by name (the tests point the rate refresh at the fake rate service `tests/api/fx-fake.mjs`, never the real one). |
| `down.sh` | Take the test server down through the runner: `docker rm -f allot-rc`, then `no-container.mjs allot-rc` (exit 1 if a container of that name remains, 2 on a docker error). Log: `$LOG_DIR/down-<time>.log` (`DOWN_LOG=<file>`). |
| `stage.sh` | Update the staging stack on :15173 (`docker/compose.dev.yaml`, real data; nothing writes test data) through the runner: `up -d --build -V --wait`, the running images, the git HEAD they were built from, and the front page answering 200. Log: `$LOG_DIR/stage-<time>.log` (`STAGE_LOG=<file>`). |
| `quiet.mjs <command...>` | Run a command with stdin, stdout and stderr discarded; print only `<program> … exit=<status>` and exit with its status (1 if it cannot start). `stage.sh` runs the compose step through it so build output (which could hold env values) never reaches the log. |
| `cleanup.mjs` | Delete rows whose name starts with `E2E-`, `V8-marker`, `V5-marker` or `V4-fixture` from every list of the test account. A marker subscription that has a plan change which is not a test row is skipped and reported (exit 1), because deleting a subscription deletes its plan changes. |
| `seed.mjs` | Create fake data the E2E assume if it is missing (settings, living costs, one target of each kind, a subscription with a plan change, an open phase covering this month, a check item). Names start with `Seed `. Run twice, it changes nothing the second time. |
| `run.sh <log-name> <command...>` | Load the test account by name, set `BASE`, wait for the login limit (`WAIT`, default 70 s), then run the command through `scripts/check-run.sh` into `$LOG_DIR/<log-name>.log`. |

`LOG_DIR` defaults to `.loctx/reports/test-server`. `check-run.sh` never overwrites a log: a name that
exists is refused (exit 64), so choose a new one. Check a log with `pnpm check:logs <file>`.

```bash
bash scripts/test-server/up.sh
bash scripts/test-server/run.sh clean-1 node scripts/test-server/cleanup.mjs
bash scripts/test-server/run.sh seed-1 node scripts/test-server/seed.mjs
bash scripts/test-server/run.sh e2e-edit pnpm exec playwright test tests/e2e/edit.spec.ts
bash scripts/test-server/down.sh   # take it down when the work is released
bash scripts/test-server/stage.sh  # then update :15173 so the user can look
```

`cleanup.mjs` and `seed.mjs` sign in once each, and the login limit is 5 per minute: set `WAIT=0` only
for a few quick runs in a row. A test account without data makes tests fail for lack of data, not for
a bug: run `seed.mjs` first. Leftover `E2E-` rows from an interrupted run do the same: run `cleanup.mjs`.
