# 02: Remove the duplicate Forgejo publishing choice

**What to build:** Users publishing a repository from Git actions should see one Forgejo / Gitea choice backed by the upstream publishing flow. Remove the stale fork-specific duplicate without removing Forgejo repository publishing.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The repository-publishing provider list contains exactly one Forgejo / Gitea choice.
- [ ] The remaining choice uses the discovered signed-in Forgejo or Gitea server and accepts an owner/repository destination.
- [ ] Publishing readiness, progress, success, and failure behavior continue to use the shared provider flow.
- [ ] Focused tests prevent the duplicate option from returning and retain Forgejo publishing coverage.
