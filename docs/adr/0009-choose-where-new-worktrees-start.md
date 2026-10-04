# ADR 0009: Choose where new worktrees start

- Status: accepted
- Date: 2026-10-04
- Tracking: [Fryuni/t3code#21](https://github.com/Fryuni/t3code/pull/21)
- Compared with upstream: `pingdotgg/t3code` at `dab26f582` (2026-10-03), after Orchestrator V2

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

Drop this divergence when upstream lets a project choose the base branch for new
worktrees.
