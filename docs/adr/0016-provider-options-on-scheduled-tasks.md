# ADR 0016: Set provider options on scheduled tasks

- Status: accepted
- Date: 2026-10-09
- Compared with upstream: `pingdotgg/t3code` at `c77a7b7ee` (2026-10-10)

Upstream stores a scheduled task's full model selection, including provider
options such as reasoning effort or fast mode, and every run passes it unchanged
to the thread it launches or wakes. Only the mobile editor can set those options.
The web editor keeps the model as an `instanceId:model` string plus a hidden copy
of the original selection, so options survive an edit but can never be chosen,
and every task created there runs on the model's defaults. The `schedule_task`
and `update_scheduled_task` MCP tools inherit the calling thread's selection with
no way to pass a different one.

The fork's web dialog keeps the full model selection in its draft
([`scheduledTasksSettings.logic.ts`](../../apps/web/src/components/settings/scheduledTasksSettings.logic.ts));
`null` follows the configured default until the user picks a model or an option.
The dialog renders the composer's provider option picker beside the model picker,
the same pairing as the project default model setting. Picking a different model
starts from that model's defaults, since options belong to a model.

The MCP schedule tools accept the same optional `target` as `delegate_task`. The
shared target resolver in
[`OrchestratorMcpService.ts`](../../apps/server/src/mcp/OrchestratorMcpService.ts)
takes an inherited model selection instead of a thread projection, so an update
edits the stored task rather than the caller's thread, and a client caller can
name a provider when its project has no default model. An omitted target keeps
the previous unvalidated inheritance, so a task saved without one keeps working
while its provider is briefly unavailable; an explicit target is validated
against the advertised option descriptors exactly like delegation. Task summaries
report the provider, model, and options so an agent can read back what it set.

When updating from upstream, preserve the draft holding a selection rather than a
key string, the resolver's inherited-selection input, and the omitted-target
short circuit. Retire this fork addition when upstream's scheduled task editor
exposes provider options and its schedule tools accept a target.
