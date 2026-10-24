# ADR 0009: Choose where new worktrees start

- Status: accepted
- Date: 2026-10-04
- Tracking: [Fryuni/t3code#21](https://github.com/Fryuni/t3code/pull/21), [#38](https://github.com/Fryuni/t3code/pull/38), [#49](https://github.com/Fryuni/t3code/pull/49)
- Compared with upstream: `pingdotgg/t3code` at `27e0c684c` (2026-10-24)

Upstream bases a new worktree branch on the repository's default branch, or on
the checked-out branch when no default is known. Repositories that integrate on
another branch, such as `dev` or `next`, make the user re-pick the base for every
thread.

The fork adds a project-only `defaultThreadBaseBranch` to
[`ProjectSettingsOverrides`](../../packages/contracts/src/settings.ts), edited as
**Default base branch** in a project's Source Control settings on web, desktop, and
mobile. When a new branch will be created, the automatic base is the user's
explicit choice, then this branch, then the repository default, then the checked-out
branch. The web branch toolbar, the web new-thread handler, and the mobile new task
flow apply it; nothing on the server changes, because clients already send the
chosen `baseRef` on the launch strategy.

It is a project override, not a server-wide setting. A branch name only means
something in one repository, so an environment default would send other projects'
threads to a branch they may not have. The key is therefore absent from
`PROJECT_SCOPED_SERVER_SETTING_KEYS` and from `ServerSettings`, and
`resolveProjectSettings` exposes it only through `overrides`, never through the
effective settings.

It is free text rather than a ref picker. The branch may not be fetched or listed
yet, since branch lists are paginated and remote refs can lag. A configured name
missing from the loaded refs is kept instead of falling back, so a wrong name fails
visibly when the worktree is created rather than silently starting from another
branch.

It is not a `t3.json` setting. [`PROJECT_FILE_BACKED_SETTINGS`](../../packages/contracts/src/t3ProjectFile.ts)
is a tier between the environment value and the built-in default, so it only accepts
`ProjectScopedServerSettingKey` keys that are nullable on `ServerSettings`. A
project-only key has neither, and widening that mechanism was not worth it for one
setting.

Agent and scheduled launches do not adopt it. `t3_thread_launch` requires an
explicit `baseRef`. `t3_worktree_handoff` defaults to the checkout's current branch,
because it moves work already in progress. Unbound scheduled tasks created over MCP
start a worktree from `main` with `startFromOrigin`; bound ones run in their thread.
The web and mobile scheduled task forms prefill `main`. Reading the default on those paths would be new behavior the fork never had.

It composes with [existing-branch mode](0008-start-threads-on-existing-branches.md)
by staying out of it: with **Create new branch** off, nothing is auto-selected, and
a new draft that asks for an existing branch is not seeded with the default, because
the default names a base, not a branch to check out.

A server without this key drops it from the override entry when it decodes the
write, so the setting does not save for projects on such a server. Upstream's
dropped-setting check ([pingdotgg/t3code#18334](https://github.com/pingdotgg/t3code/pull/18334))
covers this write too, so web Settings reports that environment as not supporting
the setting instead of leaving it silently unsaved. Override entries
are replaced whole, so a client without the key, including upstream's published
mobile app and app.t3.codes, also erases it whenever it saves another override for
the same project. Keeping unknown keys on the server would break the
clear-by-omission writes that remove overrides.

Mobile's server settings screen queues a setting saved while another write is pending
and resends it over the same targets afterwards
([pingdotgg/t3code#18381](https://github.com/pingdotgg/t3code/pull/18381)). That
queue holds environment-scoped patches, which cannot carry this project-only key, so
the base branch field is not queued: it saves only when no write is pending, and like
clearing a page's overrides it drops any queued patch, which would otherwise be
replayed over overrides read before the field's write. Upstream later moved that queue
behind `useSettingsWriter`; the field's write goes through it the same way.

## Start from upstream

**Superseded by upstream.** The fork added a tri-state `startFromRemote` (`"origin"`,
`"upstream"`, or null) to the worktree launch strategy, `t3_worktree_handoff`, web
drafts, and the mobile outbox, so a fork checkout could start a new worktree from the
canonical repository's tip without syncing the fork first. Clients offered upstream only
when the status `remoteNames` listed both remotes, and `GitWorkflowService.resolveWorktreeBase`
owned the fetch. Upstream then renamed **Start from origin** to **Start from remote**
([pingdotgg/t3code#21032](https://github.com/pingdotgg/t3code/pull/21032)): with
`startFromOrigin` set, a launch or handoff fetches the remote the base branch tracks, the
remote an explicit ref names (`upstream/main`), or origin, and starts at that commit.
Picking `upstream/main` as the base, or a local branch that tracks it, now starts at
upstream's tip, and a base such as `origin/dev` names the remote branch `dev` there too,
which the fork's [#38](https://github.com/Fryuni/t3code/pull/38) fixed separately. The
fork dropped `startFromRemote`, `WorktreeStartRemote`, `resolveWorktreeStartRemote`, the
status `remoteNames`, `resolveWorktreeBase`, and its early rejection of a missing
`upstream` remote when it synced onto upstream `8d3b06112`, and keeps upstream's
implementation. A launch strategy or scheduled task saved with `startFromRemote` still
decodes: the key is dropped and its `startFromOrigin` decides, and the fork always stored
both, so no saved scheduled task changes how it starts. Web drafts saved with
`startFromRemote: "origin"` load with **Start from remote** on. Mobile drafts and queued
tasks stored only `startFromRemote`, so they load with the `newWorktreesStartFromOrigin`
default. One behavior is lost: upstream falls back to the local branch when the chosen
remote lacks it, where the fork's upstream choice failed the launch.

Two pieces of the original change are kept on top of upstream's fetch:

- The fetch stage reports what it fetched (`<remote>/<branch> at <sha>`), and a remote
  without the branch is a `warning` ("not found, using local branch") instead of a
  silent fallback. Upstream reported both before Orchestrator V2, and its contracts and
  clients still render them; [`ThreadLaunchService`](../../apps/server/src/orchestration-v2/ThreadLaunchService.ts)
  sets them around upstream's `fetchWorktreeBaseCommit`.
- Branch searches list an exact local match, then an exact remote match, before partial
  matches, so the ref a picker selects matches the name typed, `upstream/main` included.
  Upstream's test for finding a PR worktree beyond the first ref page
  ([pingdotgg/t3code#18407](https://github.com/pingdotgg/t3code/pull/18407)) pushes the
  branch off page one with alphabetically earlier partial matches; in the fork the exact
  match stays on page one, and that test asserts so.

Drop the default base branch when upstream lets a project choose the base branch for
new worktrees, the fetch stage detail when upstream reports it again, and the exact-match
ordering when upstream's branch search puts exact names first.
