# ADR 0024: Apply provider edits to all environments

- Status: accepted
- Date: 2026-10-24
- Compared with upstream: `pingdotgg/t3code` at `fef851bee` (2026-10-24)

Most server settings can be edited once for **All environments**, but
**Settings → Providers** always showed one environment. Users who run the same
providers on several machines had to repeat every custom model and provider
change on each one.

Providers now joins the All environments scope when no project is selected. The
page shows the primary environment, and an edit to a provider instance is also
sent to every other connected environment that has that instance id with the
same driver; a driver's default slot counts as present everywhere.
[`planProviderInstanceSync`](../../apps/web/src/components/settings/SettingsPanels.logic.ts)
copies only the fields the edit changed, one level into the driver `config`
and by name in the `environment` variable list, onto each environment's own
copy. An omitted `config` clears only the fields the source had. Copying the whole instance would overwrite
machine-specific binary paths and send redaction markers for secrets the target
never saved. Disabling the instance a target uses for text generation resets
that target's text generation model, as the source write does.

This stays a bulk edit, as the rest of All environments is: offline
environments keep their values and nothing is stored to replay later. Adding,
deleting, resetting and setup flows stay on the shown environment because they
install binaries, sign in accounts, or remove machine state. A project scope
still picks one environment, because project provider overrides are stored per
environment. Mobile has no provider config editor, so it is unchanged.

When updating from upstream, preserve the field-level copy and the same id and
driver rule. Remove this if upstream adds its own cross-environment provider
sync.
