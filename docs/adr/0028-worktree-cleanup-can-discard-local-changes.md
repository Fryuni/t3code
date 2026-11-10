# ADR 0028: Worktree cleanup can discard local changes

- Status: accepted
- Date: 2026-11-10
- Compared with upstream: `pingdotgg/t3code` at `402d0623d` (2026-11-09)

Upstream's **Keep worktrees with local changes** setting (`worktreeKeepWhen`) always
protects at least edited tracked files, so a settled worktree with stray edits is never
removed. The fork owner wants T3-managed worktrees gone once their thread has settled
for the configured days, whatever is in them.

The setting gains a **Never** choice. [Storage cleanup](../../apps/server/src/storageCleanup.ts)
then skips its local-change checks and runs `git worktree remove --force`, which deletes
tracked edits and untracked and ignored files, including in submodules. The other
protections stay: only T3-managed worktrees, no active session, terminal, or shared
worktree, no branch or HEAD change since the check, no locked worktree, and no
submodule commits missing from a remote. Branches and thread history are kept.

Never is stored as a separate boolean, `worktreeDiscardLocalChanges`, not as a fourth
`worktreeKeepWhen` value. The fork ships no desktop or mobile builds
([ADR 0011](0011-fork-release-source.md)), so upstream clients connect to fork servers.
Their schemas reject an unknown enum value, which would make the whole settings
snapshot undecodable, but drop an unknown key. Upstream clients therefore keep working
and show the underlying `worktreeKeepWhen`. Servers advertise the
`worktreeDiscardLocalChanges` capability, and the web client offers Never only when
every selected server has it, since older servers drop the key.

Other tools also remove worktrees. A worktree that is already gone when cleanup reaches
it was always skipped. One removed while cleanup checks it is now skipped too, unless
T3 Code had started removing it itself. A worktree whose `.git` file was removed is kept
as "not a linked worktree" instead of failing on every run.

Drop the boolean and capability if upstream adds an equivalent choice; keep the
vanished-worktree handling unless upstream does the same.
