# ADR 0012: Worktree cleanup reclaims ignored files

- Status: accepted
- Date: 2026-10-04
- Tracking: [Fryuni/t3code#46](https://github.com/Fryuni/t3code/pull/46)
- Compared with upstream: `pingdotgg/t3code` at `37eaf5d29` (2026-10-08)

Upstream's automatic worktree cleanup (`c4ca1b0f9`, #11598) keeps any worktree that
holds an ignored path other than `node_modules/`, on the grounds that ignored files can
be secrets or local data. Nearly every real worktree has ignored build output or
caches, so in practice no worktree was ever old enough to go, and the inactivity limit
did nothing on the fork owner's instance.

The fork drops both ignored-file checks from
[`storageCleanup.ts`](../../apps/server/src/storageCleanup.ts). An eligible worktree is
removed with everything git ignores in it, including `.env` files and local datasets.
Every other protection stays: only T3-managed worktrees, no active session or terminal,
no shared worktree or project root, no uncommitted or untracked changes, and the final
re-check that HEAD and the settings did not move. Removal still runs
`git worktree remove` without `--force`, which deletes ignored files but refuses
untracked or modified ones.

The cost is that a secret or dataset that only lived in an ignored file of an inactive
worktree is gone. Cleanup is opt-in per machine or project, and
[project settings](../user/project-settings.md) says ignored files are removed.

Rejected alternatives:

- An allowlist of disposable ignored paths, such as upstream's `node_modules/`
  exception widened to `build/` or `.cache/`. Every project names its outputs
  differently, so any list keeps some worktrees forever.
- A setting to choose. Nobody on the fork wants the retaining behavior.

Drop this if upstream stops treating ignored files as a reason to keep a worktree.
