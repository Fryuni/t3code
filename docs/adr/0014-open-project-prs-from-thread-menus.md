# ADR 0014: Open project PRs from thread menus

- Status: accepted
- Date: 2026-10-09
- Compared with upstream: `pingdotgg/t3code` at `58e60bf5e` (2026-10-29)

Opening the PR page without a project filter can load PRs across hundreds of
projects, and finding the project in the filter can itself be cumbersome. The
fork adds **Show project's PRs** beside **Project settings** in the thread and
new-thread context menus, including sidebar thread and draft rows. This gives users a
direct path to find a PR and start a thread on it. Upstream deleted the legacy sidebar
([pingdotgg/t3code#21039](https://github.com/pingdotgg/t3code/pull/21039)), and the fork's
entry there went with it.

The [shared navigation hook](../../apps/web/src/hooks/useOpenPullRequestList.ts)
opens the existing PR page with the source thread or draft's exact project and
environment in the URL before the list loads. It uses that physical project rather
than the sidebar's logical project group, since a group can include several
checkouts or environments. Other list preferences are retained, but the saved host
filter is cleared so a previous project's host cannot exclude the target's PRs.
The page's existing filters remain the way to change or clear the scope.

This applies to web and desktop. Mobile has no PR list page to open. The shortcut
is available to read-only clients and is shown only when the target environment
advertises PR support; it reuses the existing list API and capability.
Selection rechecks that the exact project still exists and its environment is
connected and supports PRs, since a menu can outlive its target and the PR page
treats unavailable scopes as a request for a broader list. Connection state must
be checked separately: project and capability data remain cached after disconnect.

The same hook backs the sidebar's **Pull requests** button and the command palette's
**Open pull requests**, which open the page scoped to the project the sidebar is
filtered by. They resolve the filter's logical group to a member whose environment
supports PRs, and are disabled with a reason while no member can, or while project
snapshots are still loading and cannot yet show a saved filter is gone. Upstream lets
the sidebar filter several projects at once
([pingdotgg/t3code#25284](https://github.com/pingdotgg/t3code/pull/25284)), but the PR
page filters by one, so a filter of several opens the page unscoped, as upstream does.

When updating from upstream, preserve navigation to the exact project and
environment before any list request. Retire this fork addition when upstream
provides equivalent shortcuts in both the thread and new-thread menus, and the sidebar
scoping when upstream's PR entry points follow the sidebar filter.
