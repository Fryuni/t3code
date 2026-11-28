# ADR 0016: Set provider options on scheduled tasks

- Status: accepted
- Date: 2026-10-09
- Compared with upstream: `pingdotgg/t3code` at `2547fb284` (2026-11-28)

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
fork's wrapper around both pickers already provides it. Upstream's editor now names a
thread-bound task's destination and says each run uses that thread's current model
([pingdotgg/t3code#26658](https://github.com/pingdotgg/t3code/pull/26658)); the option
picker stays shown for both kinds, as the model picker does. Upstream then merged the
composer's model and effort pickers into one control
([pingdotgg/t3code#28057](https://github.com/pingdotgg/t3code/pull/28057)), but its
settings pages still pair the model picker with the separate option picker, so the
dialog keeps that pairing.

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
its defaults. Upstream later drops inherited options the model no longer advertises
([pingdotgg/t3code#28133](https://github.com/pingdotgg/t3code/pull/28133)), so an update with
a target also drops the stored task's stale options. Upstream's
[#23040](https://github.com/pingdotgg/t3code/pull/23040) changed the option picker's
prompt props; the dialog passes the task prompt through the new ones. Upstream's
[#22557](https://github.com/pingdotgg/t3code/pull/22557) deleted the toolkit integration
test that held the fork's schedule-target assertions; the fork's unit tests in
`OrchestratorMcpService.test.ts` keep that coverage.

Upstream cut its tool copy by more than half
([pingdotgg/t3code#24850](https://github.com/pingdotgg/t3code/pull/24850)). The schedule
tools take upstream's short descriptions with one clause each about `target`, and
`list_scheduled_tasks` no longer enumerates the fields a summary reports.

Upstream then folded `update_scheduled_task` into `schedule_task`, which updates a task
when given its `scheduledTaskId`
([pingdotgg/t3code#25423](https://github.com/pingdotgg/t3code/pull/25423)). The combined
input keeps the fork's `target`, whose description says an update without one keeps the
task's selection, and the handler's update branch passes it on, which upstream's leaves
out. Upstream's update branch later passes `freshSession` too
([pingdotgg/t3code#34801](https://github.com/pingdotgg/t3code/pull/34801)), beside the
fork's `target`. The service still takes separate create and update inputs. Upstream's
[`agentContextBudget.json`](../../apps/server/src/provider/agentContextBudget.json) must equal
the measured agent context, so it records the fork's MCP tool list, about 1 KB larger than
upstream's with this `target` and [ADR 0008](0008-start-threads-on-existing-branches.md)'s
`createBranch`. The fork drops the workflow that blocks growth, per
[ADR 0011](0011-fork-release-source.md).

Upstream's Labs cleanup removed the plan mode setting
([pingdotgg/t3code#33131](https://github.com/pingdotgg/t3code/pull/33131)), so the dialog's
option picker offers the plan agent from the selection's own options, as upstream's other
settings pickers do. Upstream moved `scheduleLabel` into
`scheduledTasksSettings.logic.ts` for the thread automations panel; the dialog's own copy
went with it, and its `splitModelKey` stays gone because the draft holds a selection.
Upstream now also treats an inherited selection's model alias as the same model when it
decides whether a target keeps the inherited options; the resolver keeps the fork's guard
for an absent inherited selection.

Upstream's `schedule_task` now takes a client caller's default from the project's effective
settings rather than the legacy project field
([pingdotgg/t3code#37299](https://github.com/pingdotgg/t3code/pull/37299)); the inherited
selection a `target` merges over reads the same effective default. Upstream's editor now locks
a thread-bound task's model picker on the thread's current model, since its runs ignore the
saved one ([pingdotgg/t3code#36628](https://github.com/pingdotgg/t3code/pull/36628)); the option
picker follows it, showing that thread's options and locked the same way. The measured tool list
is upstream's 62,140 bytes plus the fork's 994, or 63,134. Upstream's delegation now also
accepts models from the project's own provider config, read from the parent's workspace
([pingdotgg/t3code#39247](https://github.com/pingdotgg/t3code/pull/39247)); the schedule tools'
resolver calls pass no workspace, so a `target` there is checked against the environment's
providers, as before.

**Implemented upstream for the web dialog.** Upstream's editor now keeps the full selection in
its draft and renders the option picker beside the model picker
([pingdotgg/t3code#30253](https://github.com/pingdotgg/t3code/pull/30253)), so the fork dropped
its dialog changes when it synced onto upstream `cc61cdb1e` and keeps upstream's. Upstream hides
the option picker for a thread-bound task, where the fork showed the thread's options locked;
the fork's `taskToDraft` test still covers the stored options. The rest of this record's web
paragraphs describe the fork's dialog as it stood before.

Upstream then refused a target that picks the agent's own mode, such as a plan agent, unless
the caller runs in Full access or already holds that mode
([pingdotgg/t3code#39489](https://github.com/pingdotgg/t3code/pull/39489)). Its resolver reads
both from the parent thread. The fork's resolver takes the caller's runtime mode instead:
delegation passes the parent thread's, as upstream does, and the schedule tools pass the caller's
limits, which a task's runs use. A mode counts as held when the inherited selection, the caller
thread's or the stored task's, already has it on the same instance.

When updating from upstream, preserve the resolver's inherited-selection and caller runtime
mode inputs and the omitted-target short circuit. Retire this fork addition when upstream's
schedule tools accept a target.
