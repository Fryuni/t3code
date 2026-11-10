# ADR 0028: Worktree cleanup can discard local changes

- Status: accepted
- Date: 2026-11-10
- Compared with upstream: `pingdotgg/t3code` at `402d0623d` (2026-11-09)

Upstream's **Keep worktrees with local changes** setting (`worktreeKeepWhen`) always
protects at least edited tracked files, so a settled worktree with stray edits is never
removed. The fork owner wants T3-managed worktrees gone once their thread has settled
for the configured days, whatever is in them.

The fork adds a **Never** value (`"never"`). [Storage cleanup](../../apps/server/src/storageCleanup.ts)
skips its local-change checks for it and runs `git worktree remove --force`, which
deletes tracked edits, untracked and ignored files, including in submodules. The other
protections stay: only T3-managed worktrees, no active session, terminal, or shared
worktree, no branch or HEAD change since the check, no locked worktree, and no
submodule commits missing from a remote. Branches and thread history are kept.

Other tools also remove worktrees. A worktree that is already gone when cleanup reaches
it was always skipped; one removed while cleanup was checking it is now skipped too,
instead of being reported as a failure.

Older clients and servers do not know `"never"`: an old server rejects the setting, and
an old client cannot decode settings that use it. Pick it only once every connected
client and server is updated.

Drop the value if upstream adds an equivalent; keep the vanished-worktree skip unless
upstream handles it.
