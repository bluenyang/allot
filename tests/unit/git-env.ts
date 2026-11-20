// The environment for git commands that a test runs in its own temporary repository.
// A git hook (the pre-commit gates) runs the tests with GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE … set
// for the repository being committed; a child git that inherits them works on that repository instead
// of the test's temporary one (in a linked worktree, `git init --bare` then marked the real repository
// bare). Drop every variable git treats as repository-local before running git in a test.
import { execFileSync } from 'node:child_process'

const LOCAL = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8', env: {} })
  .split('\n').map((s) => s.trim()).filter(Boolean)

export function gitFreeEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const k of LOCAL) delete env[k]
  return env
}
