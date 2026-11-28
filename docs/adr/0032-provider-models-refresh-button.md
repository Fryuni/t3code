# ADR 0032: Refresh models button on provider settings

- Status: accepted
- Date: 2026-11-20
- Compared with upstream: `pingdotgg/t3code` at `2547fb284` (2026-11-28)

The Providers settings panel previously had a top-level "Refresh provider status" button that
re-probed every provider on the environment, with no way to refresh just the selected provider's
model list from its Models section.

[ProviderInstanceCard](../../apps/web/src/components/settings/ProviderInstanceCard.tsx) adds a
"Refresh models" action in the Models section header, wired through
[ProviderSettingsPanel](../../apps/web/src/components/settings/ProviderSettingsPanel.tsx) to the
existing `server.refreshProviders` RPC with `{ instanceId, refreshModels: true }`. The button is
disabled while the provider is disabled or already refreshing, and surfaces failures in a toast.

Preserve when updating from upstream unless upstream adds a per-provider model refresh button to the
provider config page, in which case drop this fork change in favor of upstream's control.
