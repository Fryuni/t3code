# ADR 0019: Search the settings project scope picker

- Status: superseded by upstream
- Date: 2026-10-15
- Compared with upstream: `pingdotgg/t3code` at `1451e7cb2` (2026-10-18)

**Superseded.** Upstream made the settings scope pickers searchable in
[pingdotgg/t3code#19744](https://github.com/pingdotgg/t3code/pull/19744)
(`6d73370ef`): once there are more than six options, the project and environment
pickers open a combobox whose search matches each option's name, its machines or
path, and its key. **All projects** stays in the results when the query matches
it. The fork dropped its combobox and `filterProjectAxisItems` when it synced onto
upstream `b827ca48d` and keeps upstream's implementation. The rest of this record
describes the decision as it stood before.

The "Applying settings for <project>" picker at the top of Settings pages was a
plain menu listing every project. With many projects, finding the one to
override meant scrolling a long list, while the sidebar project filter and the
new-thread project picker both offer a search field.

The [settings project picker](../../apps/web/src/components/settings/SettingsScopeSentence.tsx)
is now a combobox with a "Search projects..." field, filtered by
`filterProjectAxisItems` like the sidebar project filter: **All projects** heads
the unfiltered list and drops out while a query is typed, so the first match is
highlighted and Enter selects it. The filter compares against
`ALL_PROJECTS_VALUE` itself instead of calling the sidebar's
`filterSidebarProjectScopeItems`, which hard-codes the sidebar's own `"all"`
sentinel and is upstream code. The environment picker stays a menu; environment
lists are short. This applies to web and desktop. Mobile chooses the settings
project from a native header menu, like its other project filters, which cannot
host a search field, so it is unchanged. No contract, server, or provider
behavior changes.

When updating from upstream, keep the project picker searchable and its
filtering consistent with the sidebar project filter. Remove this fork change if
upstream makes the picker searchable itself.
