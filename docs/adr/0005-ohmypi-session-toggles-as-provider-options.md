# ADR 0005: OhMyPi session toggles are provider options applied at process launch

- Status: accepted
- Date: 2026-09-21
- Compared with: OhMyPi 18.2.7 over ACP

OhMyPi's computer use, advisor, and prewalk are session behaviors that its CLI
users enable with slash commands before their first message. Over ACP they are
not config options, and enabling them through `/computer on`, `/advisor on`, or
`/prewalk` only changes the running process: the omp session file never records
them, and a `session/load` in a fresh process comes back with all three off.
T3 Code stops idle provider sessions and resumes them by session id, so a state
set once by commands silently decays.

The fork therefore treats these as provider options: per-thread choices that
T3 persists with the thread and re-applies whenever the session starts. They
appear as boolean option descriptors on every OhMyPi model, so the existing
traits picker, mobile thread settings, new-thread defaults, and project model
defaults carry them with no OhMyPi-specific UI.

The adapter applies them at launch rather than by sending commands. `omp acp`
forwards launch flags, so prewalk travels as `--prewalk` or `--no-prewalk`; omp
ignores prewalk's config key while restoring a session but honors the flags.
Advisor and computer use have no off flag, so both ride a small YAML overlay
that T3 writes under its userdata and passes with `--config`. The overlay
deep-merges on top of omp's global and project config instead of replacing it,
and an explicit `false` there overrides a global `true`. A process launched this
way reports the toggles on for new and resumed sessions alike, and the same
session resumed without them reports them off, so the desired state is exactly
what the process was told. Every launch states all three explicitly, on or off,
so the control never depends on omp's global config and a user preference lives
in T3's new-thread and project defaults. Changing a toggle
mid-thread reuses the reactor's restart-with-resume path that already handles
permission mode and Claude model selection changes. The reactor learns which
options need a restart from an adapter capability that lists their ids, so a
thinking-level change keeps its in-session path and does not reset the
advisor's accumulated context.

Sending the commands as hidden prompts was rejected: prewalk has no off command,
each command is a separate round trip that can fail halfway, and the adapter
would have to swallow the agent output chunks those commands emit. Vibe mode is
not exposed over ACP at all in 18.2.7 and is out of scope.

See [OhMyPiAcpSupport.ts](../../apps/server/src/provider/acp/OhMyPiAcpSupport.ts)
for the launch arguments and
[ProviderCommandReactor.ts](../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts)
for the restart decision.
