# ADR 0014: Open project PRs from thread menus

- Status: accepted
- Date: 2026-10-09

Opening the PR page without a project filter can load PRs across hundreds of
projects, and finding the project in the filter can itself be cumbersome. The
fork adds **Show project's PRs** beside **Project settings** in the thread and
new-thread context menus, including sidebar thread and draft rows and the legacy
sidebar. This gives users a direct path to find a PR and start a thread on it.

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

When updating from upstream, preserve navigation to the exact project and
environment before any list request. Retire this fork addition when upstream
provides equivalent shortcuts in both the thread and new-thread menus.
