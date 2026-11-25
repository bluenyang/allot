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
| `cleanup.mjs` | Remove what an interrupted, stopped or timed-out run left, through the API, printing each removal: reject the test account's pending AI proposals made by a test key or touching a test row; delete rows whose name starts with `E2E-`, `V8-marker`, `V5-marker` or `V4-fixture` from every list of the test account; delete the test account's API keys named like a test's (prefixes `E2E-`, `PK-`, `F3-`, `v4`, and the exact names `tests/api/api-keys.mjs` and `mcp.mjs` use); delete the users whose email is a test pattern (`v2-…`, `v4-…`, `v8-…`, `pk-…`, `iso-b-…`, `e2e-…` and the other prefixes in the script, all `@example.com`; never the test account). A marker subscription that has a plan change which is not a test row is skipped and reported (exit 1), because deleting a subscription deletes its plan changes. |
| `seed.mjs` | Create fake data the E2E assume if it is missing (settings, living costs, one target of each kind, a subscription with a plan change, an open phase covering this month, a check item). Names start with `Seed `. Run twice, it changes nothing the second time. |
| `disposable.sh <log-name> <command...>` | For the checks that also write to the database directly (`tests/api/mcp.mjs` auth/isolation/tools/write, `tests/api/api-keys.mjs`): a throwaway `postgres:16` on 127.0.0.1:15183 with a role that is not a superuser and its own database (`disposable-db.mjs`), after `port-free.mjs` finds both ports free, `pnpm db:admin`, the API of this working tree on port 15184 (`spawn.mjs`, which fails when the API exits within 3 s; it listens on every interface, as the app does, so it is reachable from the LAN while the run lasts — fake data, random account; the checks use `BASE=http://127.0.0.1:15184`), `seed.mjs`, then the command with `BASE`, `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`; the container and the API are removed at the end, also on a failure. Every password and key is random for the run and passed by name. Log: `$LOG_DIR/<log-name>.log`, the API's output `<log-name>.api.log`. Touches neither :15173 nor :15174 (retro 0.1.8). |
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
