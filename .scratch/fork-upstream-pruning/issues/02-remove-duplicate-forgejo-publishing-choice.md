# 02: Remove the duplicate Forgejo publishing choice

**What to build:** Users publishing a repository from Git actions should see one Forgejo / Gitea choice backed by the upstream publishing flow. Remove the stale fork-specific duplicate without removing Forgejo repository publishing.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] The repository-publishing provider list contains exactly one Forgejo / Gitea choice.
- [x] The remaining choice uses the discovered signed-in Forgejo or Gitea server and accepts an owner/repository destination.
- [x] Publishing readiness, progress, success, and failure behavior continue to use the shared provider flow.
- [x] Focused tests prevent the duplicate option from returning and retain Forgejo publishing coverage.

## Comments

- 2026-09-19: Implemented in commit `e558eaecb` on `t3code/prune-branch-divergence`. The publish
  provider catalog, readiness check, and host resolution moved into
  `apps/web/src/components/GitActionsControl.logic.ts` so the single Forgejo / Gitea choice is
  covered by `GitActionsControl.logic.test.ts`. Server-side Forgejo publishing was untouched.
