# ADR 0008: Start threads on existing branches

- Status: accepted
- Date: 2026-10-04
- Tracking: [Fryuni/t3code#8](https://github.com/Fryuni/t3code/pull/8)
- Compared with upstream: `pingdotgg/t3code` at `dab26f582` (2026-10-03), after Orchestrator V2

Upstream's **New worktree** mode always creates a branch: the selected ref is
only a base, and the thread works on a fresh temporary branch that is renamed
later. A user who wants an agent on a branch that already exists, such as a
colleague's PR branch or their own unfinished work, has to create the worktree
by hand.

The fork adds a **Create new branch** toggle beside **Start from origin** on web,
desktop, and mobile. Turning it off sends `createBranch: false` on the worktree
[launch strategy](../../packages/contracts/src/orchestrationV2.ts), and the server
checks out `baseRef` itself in the new worktree. The field is explicit rather than
inferred from a missing `branch`, because a missing `branch` already means "generate
a name", and absent `createBranch` keeps every existing caller, including agents
using `t3_thread_launch`, on upstream behavior.

[`ThreadLaunchService`](../../apps/server/src/orchestration-v2/ThreadLaunchService.ts)
rejects requests it cannot honor before the thread exists: `createBranch: false`
combined with `branch` or `startFromOrigin`, a ref that is not a local branch, and
a branch another worktree or the project checkout already has. The guard does not
live in the git driver. `ProviderTurnStartService` recreates a deleted worktree
through the same driver call without a new branch name and relies on git's DWIM
behavior, which recreates a missing local branch from `origin/<name>`; a driver
check for an existing local branch would break that recovery.

Servers advertise the `existingBranchWorktree` environment capability. Older
servers strip unknown keys from the launch strategy and would silently create a
branch, so clients hide the toggle unless the capability is present. Mobile's
outbox stores the choice as an optional field without bumping its schema version,
because upstream holds outbox writes at v3 so older bundles can still read them;
absent means a branch is created.

Multi-model fan-out always creates branches, since every model needs its own
branch and only one worktree can hold an existing one. After a background
`Cmd+Enter` submission on an existing branch, the next draft clears its branch for
the same reason. Scheduled tasks do not offer the toggle: a recurring run would
find its branch still checked out by the previous run.

Drop this divergence when upstream can start a worktree thread on an existing
local branch.
