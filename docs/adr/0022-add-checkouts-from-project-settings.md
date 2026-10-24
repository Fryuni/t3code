# ADR 0022: Add checkouts from project settings

- Status: accepted
- Date: 2026-10-18
- Compared with upstream: `pingdotgg/t3code` at `27e0c684c` (2026-10-24)

The **Checkouts** section in a project's settings appeared only when the project
already had more than one checkout. A project checked out on one machine gave no
hint that it could live on another, and adding it there meant leaving settings,
opening the command palette, choosing the machine and clone source, and pasting
the remote by hand.

Project settings now show **Checkouts** whenever a connected machine lacks a
checkout of the project, even while the existing checkout's machine is offline,
or the project has several checkouts, and offer each such machine. With a
single connected machine holding the only checkout, the section stays hidden. Targets are computed across the
whole project group rather than the selected machine scope, disappear once
every connected machine has a checkout. Scratch projects and projects set to
**Keep separate** grouping never gain a checkout this way, since a copy elsewhere would be a
project of its own, so a lone checkout of one keeps the section hidden. The shared rules live in
[`projectCheckoutOptions` and `projectCheckoutCloneUrl`](../../packages/client-runtime/src/operations/projects.ts).

The new checkout must land in the same project group, so the clone URL follows
the group's identity. Grouping uses a fork's `origin`, while the repository
locator prefers `upstream`. The fork first added `RepositoryOrigin.remoteUrl` for
this; upstream later added the same field, filled with the raw origin remote
([pingdotgg/t3code#22492](https://github.com/pingdotgg/t3code/pull/22492)), and the
fork keeps upstream's field and
[identity resolver](../../apps/server/src/project/RepositoryIdentityResolver.ts).
Whichever remote is chosen goes through the shared
[`withoutRemoteCredentials`](../../packages/shared/src/git.ts) on the client before it
is cloned, because both fields carry the checkout's raw remote and the destination
machine brings its own credentials.

Upstream then added a dialog that clones a project onto another machine from the
composer's **Run on** picker
([pingdotgg/t3code#22180](https://github.com/pingdotgg/t3code/pull/22180),
[#22254](https://github.com/pingdotgg/t3code/pull/22254)), with a protocol choice,
`.env` copying, and navigation to the new project. It is not reachable from settings,
so this decision stands, but web now uses that dialog instead of a flow of its own:

- **Web and desktop:** the [settings panel](../../apps/web/src/components/settings/ProjectSettingsPanel.tsx)
  adds an **Add checkout** menu to the section header. Choosing a machine calls
  upstream's `openAddProjectToMachine` with a group member that has a remote,
  preferring one whose machine is online. Targets come from upstream's
  `useAddProjectTargets`, so machines without `source-control:write` or clone
  tracking are not listed, and a project without a remote gets none. The
  [dialog](../../apps/web/src/components/AddProjectToMachineDialog.tsx) strips
  credentials from the URL it clones, a one-line fork change that also covers
  **Run on**. Until this sync, web routed to the command palette's add-project flow
  through an `addProjectTarget` on the palette bus, listed machines without the
  needed grants as disabled, and fell back to choosing a folder; all three were
  dropped with that route.
- **Mobile:** upstream's [project overview](../../apps/mobile/src/features/settings/SettingsProjectOverviewRouteScreen.tsx)
  now always shows its Checkouts section, with checkout removal
  ([pingdotgg/t3code#21409](https://github.com/pingdotgg/t3code/pull/21409)). The fork
  appends a **Check out on** row per target, which pushes the existing clone
  destination screen, or the local folder screen without a clone URL, and is disabled
  when the machine's grant lacks `orchestration:operate`, or `source-control:write`
  when cloning. A clone registers the repository root, so a project in a repository
  subdirectory or with an unknown repository root, a remote that only resolves on the
  source machine (a path, a loopback host or a remote-helper address), or a fork
  reported by an older server without `origin.remoteUrl`, gets no prefilled clone.
  A tracked clone also takes the title every existing checkout shares
  ([`projectCheckoutTitle`](../../packages/client-runtime/src/operations/projects.ts)),
  because a member whose title differs makes a renamed group fall back to the
  repository's name.

Upstream stopped exporting `resolveProjectGroupingMode` when it trimmed its tests
([pingdotgg/t3code#22557](https://github.com/pingdotgg/t3code/pull/22557)); the fork
exports it again for the web visibility rule. Upstream later restored its own
`ProjectSettingsPanel` browser tests
([pingdotgg/t3code#24011](https://github.com/pingdotgg/t3code/pull/24011)), and the fork's
checkout tests now run in that file's harness.

When updating from upstream, keep the section visible with a second connected
machine, keep web on upstream's add-to-machine dialog and mobile on its existing
add-project screens rather than a second clone flow, and keep credentials out of the
cloned URL. Remove the web entry point if upstream adds the dialog to project
settings, and the mobile rows if upstream adds its own way to check a project out
on another machine there.
