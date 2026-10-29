# ADR 0008: Start threads on existing branches

- Status: accepted
- Date: 2026-10-04
- Tracking: [Fryuni/t3code#8](https://github.com/Fryuni/t3code/pull/8), [Fryuni/t3code#14](https://github.com/Fryuni/t3code/pull/14)
- Compared with upstream: `pingdotgg/t3code` at `58e60bf5e` (2026-10-29)

Upstream's **New worktree** mode always creates a branch: the selected ref is
only a base, and the thread works on a fresh temporary branch that is renamed
later. A user who wants an agent on a branch that already exists, such as a
colleague's PR branch or their own unfinished work, has to create the worktree
by hand.

The fork adds a **Create new branch** toggle beside **Start from remote** on web,
desktop, and mobile. Turning it off sends `createBranch: false` on the worktree
[launch strategy](../../packages/contracts/src/orchestrationV2.ts), and the server
checks out `baseRef` itself in the new worktree. The field is explicit rather than
inferred from a missing `branch`, because a missing `branch` already means "generate
a name", and absent `createBranch` keeps every existing caller, including agents
using `t3_thread_launch`, on upstream behavior. Upstream's `delegate_task` worktree
isolation ([pingdotgg/t3code#19102](https://github.com/pingdotgg/t3code/pull/19102))
builds its own strategy from the parent's commit without these fields, so delegated
worktrees always create a branch.

[`ThreadLaunchService`](../../apps/server/src/orchestration-v2/ThreadLaunchService.ts)
rejects requests it cannot honor before the thread exists: `createBranch: false`
combined with `branch` or `startFromOrigin: true`, a ref that is not a local branch, and
a branch another worktree or the project checkout already has. The guard runs there,
before the thread exists, rather than in the git driver, which `ProviderTurnStartService`
also calls to recreate a deleted worktree. Upstream's recovery
([pingdotgg/t3code#18359](https://github.com/pingdotgg/t3code/pull/18359)) checks out the
branch when it still exists locally and otherwise creates it from the project's current
branch.

Servers advertise the `existingBranchWorktree` environment capability. Older
servers strip unknown keys from the launch strategy and would silently create a
branch, so clients hide the toggle unless the capability is present. Mobile's
outbox stores the choice as an optional field without bumping its schema version,
because upstream holds outbox writes at v3 so older bundles can still read them;
absent means a branch is created.

Upstream's mobile app can queue a task that checks out a pull request when it is sent
(`pullRequestReference`). That checkout replaces the queued workspace, so it also
resets the queued **Start from remote** and **Create new branch** choices. Upstream's
`ThreadManagementProviderInstanceDisabledError` and the fork's
`ThreadLaunchWorkspaceError` are both rejected before a thread exists, so both
release claimed attachments and both map to `invalid_request` in `t3_thread_launch`.

Multi-model fan-out always creates branches, since every model needs its own
branch and only one worktree can hold an existing one. After a background
`Cmd+Enter` submission on an existing branch, the next draft clears its branch for
the same reason. Scheduled tasks do not offer the toggle: a recurring run would
find its branch still checked out by the previous run. While the toggle is off the
**Start from remote** switch is hidden, since nothing is fetched.

Upstream later moved the web composer's send and selection logic out of `ChatView`
([pingdotgg/t3code#23062](https://github.com/pingdotgg/t3code/pull/23062),
[#23069](https://github.com/pingdotgg/t3code/pull/23069)); the toggle's state stays in
`ChatView`, its handler lives in `useComposerSelection`, and the send options in
`useComposerSend`. Upstream's mobile new task flow now reuses a worktree that already
holds the chosen branch in local mode
([pingdotgg/t3code#20825](https://github.com/pingdotgg/t3code/pull/20825)); with
**Create new branch** off, branches held by another worktree stay disabled as before.
Upstream then moved the mobile branch rows onto a shared `SelectionRow`
([pingdotgg/t3code#23924](https://github.com/pingdotgg/t3code/pull/23924)), which
receives that disabled rule. Upstream's mobile flow now derives the branch a draft shows
instead of writing it from effects
([pingdotgg/t3code#25706](https://github.com/pingdotgg/t3code/pull/25706)), so with
**Create new branch** off, `fillNewTaskWorkspaceBranch` picks no base; it reads the
capability, so a draft on an older server still gets one. Upstream also removed editing a
queued task from the new task screen
([pingdotgg/t3code#25684](https://github.com/pingdotgg/t3code/pull/25684)), and the fork's
copy of the choice there went with it. The outbox delivery, now an app service
([pingdotgg/t3code#25678](https://github.com/pingdotgg/t3code/pull/25678)), still sends
and restores it.

Upstream cut T3's agent instructions and tool copy
([pingdotgg/t3code#24850](https://github.com/pingdotgg/t3code/pull/24850)), dropping
the instructions' `t3_thread_launch` examples, including the fork's existing-branch
one. Agents now learn about `createBranch: false` only from the tool's
`workspaceStrategy` description. Upstream also capped React effects per file
([pingdotgg/t3code#24964](https://github.com/pingdotgg/t3code/pull/24964)), then replaced
the cap with a rule that each effect states its reason
([pingdotgg/t3code#26161](https://github.com/pingdotgg/t3code/pull/26161)). The branch
selector keeps the effect that clears a branch another worktree holds while
**Create new branch** is off, with a reasoned exception, because that is known only once
the paginated refs load.

## Continue on the current branch from the command palette

Upstream deliberately made every generic new-thread entry point ignore the viewed
thread's branch and worktree (upstream #4411, see
[`chatThreadActions.ts`](../../apps/web/src/lib/chatThreadActions.ts)), and keeps
**New thread on _branch_** only in the thread menu: a sidebar right-click, the chat
header title menu, or a long-press on mobile. `composer.sendAndNewThread` does not
carry the branch, and **Previous worktree** (`mod+shift+l`) only re-points a draft to
the most recent worktree, never to a local branch. A keyboard-first user had no way
to continue where they are.

The fork adds the same action to the
[command palette](../../apps/web/src/components/CommandPalette.tsx), reusing
upstream's new-thread handler and the thread menu's option mapping. It appears only
for a server thread with a branch, because for an empty open draft it would just
re-apply the draft's own branch. It is web and desktop only. Mobile's iPad keyboard
palette does not offer it, so keyboard users there still have to long-press the
thread for the thread-menu action. It has no keybinding. Like upstream's menu
item, a local-branch carry-over draft that is automatically load-balanced to another
environment drops the branch.

Drop the **Create new branch** toggle when upstream can start a worktree thread on an
existing local branch, and the palette action when upstream offers it in the command
palette.
