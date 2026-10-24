# ADR 0023: Split leading commands in a new thread's first prompt

- Status: accepted
- Date: 2026-10-24
- Compared with upstream: `pingdotgg/t3code` at `27e0c684c` (2026-10-24)

Many provider plugins turn on a mode with a slash command at the start of a
session. In T3 Code the first prompt starts the session, so a user had to spend
the first turn on the command and send the real prompt second, or interrupt the
agent to run it.

A new thread's first send now splits off its leading slash-command lines
([`splitLeadingSlashCommands`](../../packages/client-runtime/src/operations/setupCommands.ts)).
A command line is a `/name` token with no further slash, so multi-segment paths
such as `/src/app.ts` stay prose; a single-segment path such as `/tmp` does not.
A line holding a context link stays in the prompt, which carries the context
records. A send of only commands keeps its last command as the prompt.

The launch RPC carries the commands as `setupMessages`.
[`ThreadLaunchService`](../../apps/server/src/orchestration-v2/ThreadLaunchService.ts)
dispatches the first with the workspace preparation, then the rest and the prompt
as queued messages before it schedules preparation. The first run is still
preparing then, so the queue order is the send order. Sending them one RPC at a
time from the client could not promise that: a message arriving after one run
ended but before the queue promoted the next would start ahead of it.

Web and desktop split on the draft composer, including multiple-model starts.
Mobile splits when its outbox delivers a **New task** and resends the commands
with the prompt when the user chooses **Work locally**. Both offer provider
commands in the slash menu on every leading command line. Clients split only
when the server reports `threadLaunchSetupMessages`, because older servers
drop the key. Threads that already exist, including the empty one
`autoBootstrapProjectFromCwd` creates, are unchanged.

No setup message carries a title seed, and the prompt is no longer the first
message, so the server generates no title. The thread keeps the title derived
from the prompt.

When updating from upstream, preserve the launch-time dispatch order and the
capability gate. Remove this if upstream adds an equivalent way to run setup
commands before a first prompt.
