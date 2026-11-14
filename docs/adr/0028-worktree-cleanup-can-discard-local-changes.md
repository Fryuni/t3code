# ADR 0028: Worktree cleanup can discard local changes

- Status: accepted
- Date: 2026-11-10
- Compared with upstream: `pingdotgg/t3code` at `13f89ae0a` (2026-11-14)

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
and show the underlying `worktreeKeepWhen`. Their writes omit the flag, so the
[settings merge](../../packages/shared/src/serverSettings.ts) keeps the stored flag, unless
the write picks a different keep level, which turns Never off. Upstream still shows the
underlying keep level while Never is on; choosing another one there must turn Never off,
and changing an unrelated setting must not. Servers advertise the
`worktreeDiscardLocalChanges` capability, and the web client offers Never only when
every selected server has it, since older servers drop the key. A managed policy that locks
`storageCleanup.worktreeKeepWhen` also locks the flag off
([managedSettings.ts](../../apps/server/src/policy/managedSettings.ts)), so Never cannot
bypass an administrator's keep level; upstream policies need no change.

Upstream's cleanup now also removes idle No project folders under the scratch root, under
the same setting ([pingdotgg/t3code#36369](https://github.com/pingdotgg/t3code/pull/36369)).
Every file in them is untracked, so Never removes them as **Tracked changes** does.
Upstream also keeps a worktree that holds a nested Git repository
([pingdotgg/t3code#25241](https://github.com/pingdotgg/t3code/pull/25241)), and Never keeps
it too: like a submodule's, its commits may exist nowhere else.

Other tools also remove worktrees. A worktree that is already gone when cleanup reaches
it was always skipped. One removed while cleanup checks it is now skipped too, unless
T3 Code had started removing it itself. Upstream's walk before removal (#25241) keeps a
worktree it cannot finish walking, so cleanup first checks that the worktree still exists
and skips one removed during the walk. Upstream now keeps a worktree whose `.git` file was
removed as "not a linked worktree"
([pingdotgg/t3code#34894](https://github.com/pingdotgg/t3code/pull/34894)), as the fork did;
the fork keeps upstream's check and test.

Drop the boolean and capability if upstream adds an equivalent choice; keep the
vanished-worktree handling unless upstream does the same.
