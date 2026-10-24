# ADR 0023: Split leading commands in a new thread's first prompt

- Status: accepted
- Date: 2026-10-24
- Compared with upstream: `pingdotgg/t3code` at `27e0c684c` (2026-10-24)

Many provider plugins turn on a mode with a slash command at the start of a
session. In T3 Code the first prompt starts the session, so a user had to spend
the first turn on the command and send the real prompt second, or interrupt the
agent to run it.

On web and desktop, a new thread's first send now splits off the leading lines
that are slash commands (a `/name` token with no further slash, so paths stay
prose). The first command takes the thread-creation and worktree bootstrap. The
other commands and then the prompt follow as queued messages on the existing
`queue` dispatch mode, which the server already holds behind a preparing run. A
send that is only commands keeps its last command as the prompt. The split lives
in [`splitLeadingSlashCommands`](../../apps/web/src/components/chat/composerSend.logic.ts)
and the dispatch in [`useComposerSend`](../../apps/web/src/components/chat/useComposerSend.ts).

The command that creates the thread carries no title seed: the server generates
an initial title from the seeding message, and a slash command makes a poor
title. The thread keeps the title derived from the prompt instead. If a queued
follow-up fails after the thread exists, its text and the composer content
return to the new thread's composer rather than the draft. Server threads,
multiple-model starts, and mobile are unchanged; no contract or server change.

When updating from upstream, preserve the split only for local draft threads and
the queued, in-order dispatch after the bootstrap message. Remove this if
upstream adds an equivalent way to run setup commands before a first prompt.
