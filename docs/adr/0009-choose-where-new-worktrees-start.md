# ADR 0009: Choose where new worktrees start

- Status: accepted
- Date: 2026-10-04
- Tracking: [Fryuni/t3code#21](https://github.com/Fryuni/t3code/pull/21), [#38](https://github.com/Fryuni/t3code/pull/38), [#49](https://github.com/Fryuni/t3code/pull/49)
- Compared with upstream: `pingdotgg/t3code` at `ec80933ac` (2026-10-09)

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
write, so the setting does not save for projects on such a server. Override entries
are replaced whole, so a client without the key, including upstream's published
mobile app and app.t3.codes, also erases it whenever it saves another override for
the same project. Keeping unknown keys on the server would break the
clear-by-omission writes that remove overrides.

## Start from upstream

Upstream can only start a new worktree from the local base or from origin. In a fork,
origin is the fork and `upstream` is the canonical repository, so starting from the
latest upstream tip means syncing the fork by hand first.

The worktree [launch strategy](../../packages/contracts/src/orchestrationV2.ts) gains a
tri-state `startFromRemote`: `"origin"`, `"upstream"`, or null for the local ref. It
is sent alongside `startFromOrigin` rather than replacing it, because older servers
strip the unknown key and still read the boolean, so a new client keeps origin
working against them. When both are present `startFromRemote` wins
([`resolveWorktreeStartRemote`](../../packages/contracts/src/vcs.ts)). The field is
optional, so scheduled tasks persisted with only the boolean decode unchanged. The
`newWorktreesStartFromOrigin` setting stays a boolean: upstream is a per-thread choice,
not a default. Only those two remote names are recognized. Agents pass
`startFromRemote` on `t3_thread_launch`'s strategy or to `t3_worktree_handoff`.

[`GitWorkflowService.resolveWorktreeBase`](../../apps/server/src/git/GitWorkflowService.ts)
owns the fetch for UI launches, `t3_thread_launch`, and `t3_worktree_handoff`, so all
three treat prefixes and missing refs the same way:

- Origin falls back. "Start from origin" is a stored default applied to every
  repository, so a missing origin remote is skipped and a missing branch starts from
  the local base with a `warning` on the fetch stage.
- Upstream fails. Choosing it is explicit, and silently starting fork work from a
  stale local branch would be wrong, so a missing remote or branch fails the launch.
  The fetch requires the branch, so a branch deleted upstream is not served from its
  stale tracking ref. `ThreadLaunchService` also rejects a missing `upstream` remote
  before creating the thread, so agents and clients get the error immediately rather
  than as a failed preparation; a missing branch can only be found by fetching, so it
  still fails during preparation.
- A base such as `origin/dev` names the remote branch `dev`
  ([#38](https://github.com/Fryuni/t3code/pull/38)). Upstream's V2 launch looked up
  `origin/origin/dev`, missed, and passed the name through instead of the fetched
  commit. The prefix of any configured remote is stripped only when no local branch
  has that exact name, because `origin/dev` can be a real local branch.

The fetch stage detail (`<remote>/<branch> at <sha>`) and the origin fallback warning
are not divergences: upstream reported both before Orchestrator V2 and V2 dropped them
while its contracts and clients still render them.

Clients detect support through the status `remoteNames`, which servers without this
change never send, and offer upstream only when it lists both `origin` and `upstream`.
A server without it would read `startFromOrigin: false` and start from the local ref.
A saved upstream choice stays selected, with upstream disabled, when those remotes are
missing, so the user sees it and can change it instead of having it silently dropped.
Drafts and queued mobile tasks saved with only the boolean are read with
`resolveWorktreeStartRemote` on load, so no client storage version changes. The fork's
original change also refreshed status with `git fetch --all`; that was not ported,
because a background fetch of every remote on each stale status poll costs too much on
repositories with many or slow remotes, and the launch fetches the chosen remote
anyway. Branch searches also list an exact local match, then an exact remote match,
before partial matches, so the ref a picker selects matches the name typed.

Drop the default base branch when upstream lets a project choose the base branch for
new worktrees, and the upstream source when upstream can start a new worktree from a
remote other than origin.
