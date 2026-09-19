# 06: Consolidate PR opening on the shared link handler

**What to build:** Opening a supported pull-request link should follow one shared client path: normal activation opens the pull request inside T3, while the existing modifier-assisted action opens it externally. The internal view must resolve against the thread's own checkout and environment.

**Blocked by:** 04: Centralize Forgejo repository identity normalization.

**Status:** ready-for-agent

- [ ] Git actions and other supported PR-link entry points use the same shared opening behavior rather than maintaining parallel callback and browser-opening paths.
- [ ] When multiple projects check out the same repository, the active thread's project is preferred.
- [ ] The selected project belongs to the environment capable of serving the internal pull-request view; duplicate repositories in other environments do not capture the link.
- [ ] Normal activation and modifier-assisted external opening retain their current behavior across supported source-control providers.
- [ ] Every retained fork-specific routing rule has focused duplicate-checkout or multi-environment coverage; if no production code can be removed safely, the ticket records the retained rules and evidence in its Comments section.
