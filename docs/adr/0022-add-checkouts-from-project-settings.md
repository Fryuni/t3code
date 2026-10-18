# ADR 0022: Add checkouts from project settings

- Status: accepted
- Date: 2026-10-18
- Compared with upstream: `pingdotgg/t3code` at `13aa882c2` (2026-10-17)

The **Checkouts** section in a project's settings appeared only when the project
already had more than one checkout. A project checked out on one machine gave no
hint that it could live on another, and adding it there meant leaving settings,
opening the command palette, choosing the machine and clone source, and pasting
the remote by hand.

The [project settings panel](../../apps/web/src/components/settings/ProjectSettingsPanel.tsx)
now shows **Checkouts** whenever more than one machine is connected, or the
project has several checkouts. Its **Add checkout** menu lists connected machines
without a checkout of the project, across the whole project group rather than the
selected machine scope, and disappears once every connected machine has one.
Scratch projects get no menu. Picking a machine opens the existing command
palette add-project flow through a new `addProjectTarget` on the
[palette bus](../../apps/web/src/commandPaletteBus.ts): with the project's Git
remote it lands on the clone destination step for that remote, otherwise on the
machine's add-project sources. The palette keeps owning path choice, permission
checks and clone tracking, so no server, contract or provider behavior changes.
Machines whose grant lacks `orchestration:operate`, or `source-control:write`
when cloning, are listed but disabled.

Mobile already lists checkouts unconditionally and read-only; it has no settings
entry to add one, and this change does not add one.

When updating from upstream, keep the section visible with a second connected
machine and keep the menu routed through the palette rather than a second clone
flow. Remove this fork change if upstream adds its own way to check a project out
on another machine from settings.
