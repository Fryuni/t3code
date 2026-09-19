# 03: Collapse Forgejo remote discovery onto the upstream pipeline

**What to build:** Forgejo and Gitea repositories should use the upstream source-control discovery pipeline wherever it is behaviorally equivalent. Retain only the smallest extensions needed to discover real installations whose SSH clone authority differs from their web authority.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Ordinary Forgejo and Gitea remotes are discovered through the shared upstream provider pipeline without a parallel fork-only path.
- [ ] Discovery still handles distinct SSH and web hosts, nondefault SSH and HTTP ports, mounted instance paths, and advertised SSH clone URLs.
- [ ] Login selection remains unambiguous when accounts share a hostname or SSH alias, and repeated refinement does not rerun avoidable external discovery work.
- [ ] Every retained fork-specific discovery branch has a focused regression test demonstrating behavior the upstream path does not provide; equivalent branches and duplicate tests are removed.
- [ ] If no production code can be removed safely, the ticket records the exact retained differences and their regression tests in its Comments section.
