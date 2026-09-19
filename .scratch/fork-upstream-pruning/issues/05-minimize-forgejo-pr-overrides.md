# 05: Minimize Forgejo PR parsing and synchronization overrides

**What to build:** Forgejo pull requests should use upstream parsing, lookup, linking, and synchronization wherever equivalent, with fork-specific behavior retained only for demonstrated real-world compatibility cases.

**Blocked by:** 04: Centralize Forgejo repository identity normalization.

**Status:** ready-for-agent

- [ ] Pull-request references continue to accept supported URLs and repository inputs, including surrounding whitespace and mounted instance paths.
- [ ] Pull-request lookup and branch matching remain correct when owner or repository spelling differs only by case, without weakening instance-path case sensitivity.
- [ ] Linking, unlinking, settlement matching, cached summaries, and legacy-link recovery all use the centralized repository identity.
- [ ] Equivalent parsing and synchronization branches are replaced by upstream behavior, and duplicate coverage is removed without reducing edge-case coverage.
- [ ] Every retained fork-specific override has a focused regression test; if no production code can be removed safely, the ticket records the exact retained overrides and evidence in its Comments section.
