# ADR 0006: OhMyPi skills and commands come from an ephemeral ACP probe

- Status: accepted
- Date: 2026-09-21
- Compared with: OhMyPi 18.2.7 over ACP

Claude and Cursor populate the `$` skill picker by scanning skill directories
on disk. OhMyPi does not get the same treatment. Its CLI has no command that
lists skills, and its discovery walks a dozen directory families, each gated
by its own settings, plus plugin and managed-skill packages. A scan that
mirrors that would drift, and a false positive is worse than a miss: an
unknown `/skill:name` is not rejected, it reaches the model as literal text.

Instead the driver refreshes a workspace by starting a throwaway ACP session:
spawn `omp acp --session-dir <T3-owned directory>`, create a session for the
cwd, read the `available_commands_update` that omp sends about fifty
milliseconds later, then close and kill. That notification is omp's own view
of its skills, as `skill:<name>` entries with descriptions, and of every other
command, so the `/` menu is complete before the first turn too. The skill
entries are surfaced as skills and dropped from the slash command list. A
skill's only identifier is omp's `skill://<name>`, which the clients use just
to pick a source badge.

The session directory override matters: `omp acp` ignores `--no-session`, and
a probe without the override leaves an empty session in the user's omp resume
list on every refresh. A live session's own `available_commands_update` keeps
replacing the probed snapshot, so a running thread never sees stale data.

See [OhMyPiDriver.ts](../../apps/server/src/provider/Drivers/OhMyPiDriver.ts)
and, for the pattern this mirrors, the Claude capabilities probe in
[ClaudeProvider.ts](../../apps/server/src/provider/Layers/ClaudeProvider.ts).
