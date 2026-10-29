# ADR 0027: Worktree cleanup reads Git 2.56's broken gitfile error

- Status: accepted
- Date: 2026-10-29
- Compared with upstream: `pingdotgg/t3code` at `58e60bf5e` (2026-10-29)

Before removing a worktree, storage cleanup re-reads its checked-out branch and keeps
the worktree when the repository is gone or the branch moved. It recognizes a missing
repository by git's "not a git repository" error. Git 2.56 reports a `.git` file that
points to a missing directory as "gitfile does not point to a valid repository"
instead, so cleanup recorded a failure rather than "Repository or branch changed".
GitHub's `ubuntu-24.04` image moved to Git 2.56 in October 2026, and upstream's own
storage cleanup test fails there.

The [branch check](../../apps/server/src/storageCleanup.ts) accepts both messages. Other
"not a git repository" checks in the server are unchanged; no test shows them depending
on the broken-gitfile case.

Drop this when upstream recognizes the Git 2.56 message itself.
