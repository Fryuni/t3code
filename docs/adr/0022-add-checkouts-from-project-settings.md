# ADR 0022: Add checkouts from project settings

- Status: accepted
- Date: 2026-10-18
- Compared with upstream: `pingdotgg/t3code` at `13aa882c2` (2026-10-17)

The **Checkouts** section in a project's settings appeared only when the project
already had more than one checkout. A project checked out on one machine gave no
hint that it could live on another, and adding it there meant leaving settings,
opening the command palette, choosing the machine and clone source, and pasting
the remote by hand.

Project settings now show **Checkouts** whenever more than one machine is
connected, or the project has several checkouts, and offer each connected
machine without a checkout of the project. Targets are computed across the
whole project group rather than the selected machine scope, disappear once
every connected machine has a checkout, and are never offered for scratch
projects. The shared rules live in
[`projectCheckoutOptions` and `projectCheckoutCloneUrl`](../../packages/client-runtime/src/operations/projects.ts).

The new checkout must land in the same project group, so the clone URL follows
the group's identity. Grouping uses a fork's `origin`, while the repository
locator prefers `upstream`, so `RepositoryOrigin` gained an optional `remoteUrl`
that the [identity resolver](../../apps/server/src/project/RepositoryIdentityResolver.ts)
fills with the configured origin remote. Whichever remote is chosen goes through
the shared [`withoutRemoteCredentials`](../../packages/shared/src/git.ts) before
it is cloned, because the locator carries the checkout's raw remote and the
destination machine brings its own credentials. A clone registers the
repository root, so a project in a repository subdirectory or with an unknown
repository root, or a fork reported by an older server without
`origin.remoteUrl`, gets no prefilled clone: the user picks a folder instead.

- **Web and desktop:** the [settings panel](../../apps/web/src/components/settings/ProjectSettingsPanel.tsx)
  adds an **Add checkout** menu to the section header. Choosing a machine opens
  the existing command palette add-project flow through `addProjectTarget` on the
  [palette bus](../../apps/web/src/commandPaletteBus.ts): the clone destination
  step for the clone URL, or the machine's add-project sources without one. The
  palette keeps owning path choice, permission checks and clone tracking.
  Machines whose grant lacks `orchestration:operate`, or `source-control:write`
  when cloning, are listed but disabled.
- **Mobile:** the [project overview](../../apps/mobile/src/features/settings/SettingsProjectOverviewRouteScreen.tsx)
  follows the same visibility rule and adds a **Check out on** row per target,
  opening the existing clone destination screen, or the local folder screen
  without a clone URL, with the same permission-based disabling.

When updating from upstream, keep the section visible with a second connected
machine, keep both clients routed through their existing add-project flows
rather than a second clone flow, and keep `origin.remoteUrl` until upstream
exposes the fork's clone URL another way. Remove this fork change if upstream
adds its own way to check a project out on another machine from settings.
