# ADR 0027: Worktree cleanup reads Git 2.56's broken gitfile error

- Status: superseded by upstream
- Date: 2026-10-29
- Compared with upstream: `pingdotgg/t3code` at `ee90bdc94` (2026-11-12)

**Superseded.** Upstream added the same recognition in
[pingdotgg/t3code#33423](https://github.com/pingdotgg/t3code/pull/33423) (`301999c32`):
[`isNonRepositoryGitStderr`](../../apps/server/src/vcs/GitVcsDriverCore.ts) treats both
"not a git repository" and "gitfile does not point to a valid repository" as a missing
repository, and storage cleanup and GitManager both use it. The fork dropped its own check
in `storageCleanup.ts` when it synced onto upstream `ee90bdc94` and keeps upstream's
implementation. The rest of this record describes the decision as it stood before.

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
