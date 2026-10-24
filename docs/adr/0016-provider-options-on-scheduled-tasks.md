# ADR 0016: Set provider options on scheduled tasks

- Status: accepted
- Date: 2026-10-09
- Compared with upstream: `pingdotgg/t3code` at `27e0c684c` (2026-10-24)

Upstream stores a scheduled task's full model selection, including provider
options such as reasoning effort or fast mode, and passes it unchanged to the
thread an unbound run launches. A thread-bound run follows the thread's current
provider and passes none
([pingdotgg/t3code#18467](https://github.com/pingdotgg/t3code/pull/18467)), so
stored options only take effect on tasks that launch their own thread. Only the
mobile editor can set those options. The web editor keeps the model as an
`instanceId:model` string plus a hidden copy of the original selection, so options
survive an edit but can never be chosen, and every task created there runs on the
model's defaults. The `schedule_task`
and `update_scheduled_task` MCP tools inherit the calling thread's selection with
no way to pass a different one.

The fork's web dialog keeps the full model selection in its draft
([`scheduledTasksSettings.logic.ts`](../../apps/web/src/components/settings/scheduledTasksSettings.logic.ts));
`null` follows the configured default until the user picks a model or an option.
The dialog renders the composer's provider option picker beside the model picker,
the same pairing as the project default model setting. Picking a different model
starts from that model's defaults, since options belong to a model. Upstream later
wrapped its lone model picker in a `div` so the dialog no longer shifts
([pingdotgg/t3code#18940](https://github.com/pingdotgg/t3code/pull/18940)); the
fork's wrapper around both pickers already provides it.

The MCP schedule tools accept the same optional `target` as `delegate_task`. The
shared target resolver in
[`OrchestratorMcpService.ts`](../../apps/server/src/mcp/OrchestratorMcpService.ts)
takes an inherited model selection and a project instead of a thread projection, so
an update edits the stored task rather than the caller's thread, and a client caller can
name a provider when its project has no default model. An omitted target keeps
the previous unvalidated inheritance, so a task saved without one keeps working
while its provider is briefly unavailable; an explicit target is validated
against the advertised option descriptors exactly like delegation. Task summaries
report the provider, model, and options so an agent can read back what it set.
Because schedule tools reach the resolver too, its unusable-provider error says the
provider "cannot be used" rather than upstream's "cannot run a child task", and the
fork's copy of upstream's delegation test expects that wording.

Upstream later let projects turn provider instances on or off
([pingdotgg/t3code#17879](https://github.com/pingdotgg/t3code/pull/17879)). Its
driver-only target resolution skips instances the project turned off; the project
is the task's for schedule tools and the caller thread's for delegation. The web
dialog keeps upstream's rule that a draft selection on an instance disabled for the
task's project falls back to the default.

Upstream then made a target's options merge over the inherited selection for the same
instance and model, with `[]` clearing them
([pingdotgg/t3code#16595](https://github.com/pingdotgg/t3code/pull/16595)). The shared
resolver keeps the fork's inherited-selection input, so `update_scheduled_task` merges
explicit options over the stored task's options, and a different model still starts from
its defaults. Upstream's
[#23040](https://github.com/pingdotgg/t3code/pull/23040) changed the option picker's
prompt props; the dialog passes the task prompt through the new ones. Upstream's
[#22557](https://github.com/pingdotgg/t3code/pull/22557) deleted the toolkit integration
test that held the fork's schedule-target assertions; the fork's unit tests in
`OrchestratorMcpService.test.ts` keep that coverage.

When updating from upstream, preserve the draft holding a selection rather than a
key string, the resolver's inherited-selection input, and the omitted-target
short circuit. Retire this fork addition when upstream's scheduled task editor
exposes provider options and its schedule tools accept a target.
