# 04: Centralize Forgejo repository identity normalization

**What to build:** Forgejo repository remotes, stored pull-request links, and newly generated links should share one minimal identity model so the same repository matches consistently without losing instance-specific information.

**Blocked by:** 03: Collapse Forgejo remote discovery onto the upstream pipeline.

**Status:** ready-for-agent

- [ ] Repository identity preserves the Forgejo web scheme, HTTP port, mounted instance path, and path case needed to address the correct server.
- [ ] SSH remotes with a different advertised host resolve to the corresponding web instance without conflating repositories on other ports or mounts.
- [ ] Current and legacy stored links normalize to the same identity when they describe the same repository, while distinct instances remain distinct.
- [ ] Shared URL and repository helpers replace equivalent fork-specific normalization rather than layering another representation beside them.
- [ ] Every retained fork-specific identity rule has a focused regression test; if no production code can be removed safely, the ticket records the exact retained rules and evidence in its Comments section.
