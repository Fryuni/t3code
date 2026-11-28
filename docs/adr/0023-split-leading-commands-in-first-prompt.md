# ADR 0023: Split leading commands in a new thread's first prompt

- Status: accepted
- Date: 2026-10-24
- Compared with upstream: `pingdotgg/t3code` at `2547fb284` (2026-11-28)

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

A failed workspace preparation now holds the messages queued behind it, as a
missing worktree already did. The first command never reached the provider, so
the prompt must not run without it; **Retry** releases the hold. This also holds
any follow-up a user queued during setup, which previously ran after a setup
script failure. If a later launch message is rejected, the launch fails the
first run instead of leaving it preparing with nothing scheduled, and a replay
of that launch sends nothing past it.

The rule is that a failed workspace preparation or launch dispatch never lets
the rest of a launch run automatically. A command the provider runs and rejects
is an ordinary turn, so the next message follows it as if the user had sent them
one by one. An explicit user action may also release held messages: sending a new message releases held
messages as it does after a Stop, and **Resume** after a server restart during
preparation runs them without the cancelled first message. The failed or
cancelled message stays visible, so that choice is the user's.

Web and desktop split on the draft composer, including multiple-model starts.
Mobile splits when its outbox delivers a **New task**. Setup message ids derive
from the prompt's id (`<prompt>:setup:<n>`), so mobile's **Work locally** finds
the launch's commands and prompt by id and resends them, leaving follow-ups
queued during setup behind. Both offer provider
commands in the slash menu on every leading command line. Clients split only
when the server reports `threadLaunchSetupMessages`, because older servers
drop the key. Threads that already exist, including the empty one
`autoBootstrapProjectFromCwd` creates, are unchanged.

No setup message carries a title seed, and the prompt is no longer the first
message, so the server generates no title. The thread keeps the title derived
from the prompt.

Upstream later reports a launch as resumed when a concurrent retry replays its
first message ([pingdotgg/t3code#24601](https://github.com/pingdotgg/t3code/pull/24601)).
The fork checks that on the first launch message only; later messages still fail the
first run when they are rejected. Upstream's `/side` and `/btw`
([pingdotgg/t3code#26901](https://github.com/pingdotgg/t3code/pull/26901)) are handled by
the client before the split and are refused on a new thread, so they never become setup
messages.

Upstream now commits a new thread together with its first run: `thread.create` carries the
launch's first message, so no client sees the thread idle before it starts
([pingdotgg/t3code#36682](https://github.com/pingdotgg/t3code/pull/36682)). In the fork that
message is the first launch message, a setup command when there is one, and the rest still
queue behind its run. A reused thread, or a replayed claim that carried none, dispatches it
under its own command id, as upstream does. Upstream now refuses to resume a queue while
worktree setup has failed ([pingdotgg/t3code#36616](https://github.com/pingdotgg/t3code/pull/36616)),
and makes a send to an idle thread wait behind its queue
([pingdotgg/t3code#33857](https://github.com/pingdotgg/t3code/pull/33857)); the fork's hold for
any failed preparation reads the failed run that change identifies. Upstream now lets a
buffered background-task wake through a provider failure's hold, because it only replays
output the CLI already produced
([pingdotgg/t3code#38035](https://github.com/pingdotgg/t3code/pull/38035)). A failed
preparation holds every queued run, wakes included, as a missing worktree does: no provider
ran, so there is nothing to replay.

Upstream's web send now drops a failed send's optimistic row whether or not the draft is
restored ([pingdotgg/t3code#35102](https://github.com/pingdotgg/t3code/pull/35102)); the
leading commands' rows go with it. Upstream's mobile outbox reuses a launched task's workspace
when it resends after a lost reply
([pingdotgg/t3code#32330](https://github.com/pingdotgg/t3code/pull/32330)); the split runs again
and yields the same commands and ids.

Upstream's launch can ask a run for a typed result with `outputSchema`
([pingdotgg/t3code#38874](https://github.com/pingdotgg/t3code/pull/38874)). It belongs to the
prompt's run, so only the prompt carries it, never a setup message.

Upstream's web send now derives the title seed from the send snapshot, terminal context labels
included, in `deriveComposerSendTitle`. Single and multiple-model sends pass it the snapshot with
the prompt left after the split, so the title still comes from the prompt.

When updating from upstream, preserve the launch-time dispatch order, the
preparation-failure queue hold, and the capability gate. Remove this if upstream adds an equivalent way to run setup
commands before a first prompt.
