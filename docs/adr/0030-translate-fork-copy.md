# ADR 0030: Translate the fork's interface copy

- Status: accepted
- Date: 2026-11-19
- Compared with upstream: `pingdotgg/t3code` at `2547fb284` (2026-11-28)

Upstream translated the whole web, desktop, and mobile interface into every supported
language ([pingdotgg/t3code#37893](https://github.com/pingdotgg/t3code/pull/37893)).
`t3code/no-untranslated-copy` fails lint on unwrapped copy, and `vp run i18n:check` fails
when a catalog drifts from the source, so the fork's own copy must be translated too.

The fork wraps its copy the way [Translating the UI](../internals/14_i18n.md) describes and
translates its keys by hand in every locale catalog, using the terms upstream's translations
already use for the same concept (worktree, checkout, base branch, pull request). This covers
the copy added by [ADR 0008](0008-start-threads-on-existing-branches.md),
[0009](0009-choose-where-new-worktrees-start.md),
[0010](0010-public-url-for-external-proxies.md),
[0011](0011-fork-release-source.md),
[0014](0014-open-project-prs-from-thread-menus.md),
[0022](0022-add-checkouts-from-project-settings.md),
[0024](0024-sync-provider-edits-across-environments.md), and
[0028](0028-worktree-cleanup-can-discard-local-changes.md). Where the fork changed one of
upstream's strings, such as the missing-branch error that also covers **Check out in
worktree**, the fork's English gets its own key and translations, and upstream's key drops out
of the catalogs.

Upstream added Polish ([pingdotgg/t3code#41463](https://github.com/pingdotgg/t3code/pull/41463)),
so the fork's keys are translated in `pl.json` too, using that catalog's terms (`worktree`,
`checkout`, `gałąź bazowa`, `pull requesty`).

When updating from upstream, resolve conflicts with upstream's wrapping, run
`vp run i18n:generate` in `apps/web` and `apps/mobile`, and translate every fork key still in
English. Drop this when the fork has no interface copy of its own.
