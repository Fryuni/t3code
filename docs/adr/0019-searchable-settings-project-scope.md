# ADR 0019: Search the settings project scope picker

- Status: accepted
- Date: 2026-10-15
- Compared with upstream: `pingdotgg/t3code` at `339179f50` (2026-10-14)

The "Applying settings for <project>" picker at the top of Settings pages was a
plain menu listing every project. With many projects, finding the one to
override meant scrolling a long list, while the sidebar project filter and the
new-thread project picker both offer a search field.

The [settings project picker](../../apps/web/src/components/settings/SettingsScopeSentence.tsx)
is now a combobox with a "Search projects..." field, filtered like the sidebar
project filter: **All projects** heads the unfiltered list and drops out while a
query is typed, so the first match is highlighted and Enter selects it. The
filter compares against `ALL_PROJECTS_VALUE` itself instead of calling the
sidebar's `filterSidebarProjectScopeItems`, which hard-codes the sidebar's own
`"all"` sentinel and is upstream code. The environment picker stays a menu;
environment lists are short. This applies to web and desktop. Mobile chooses the settings project from a
native header menu, like its other project filters, which cannot host a search
field, so it is unchanged. No contract, server, or provider behavior changes.

When updating from upstream, keep the project picker searchable and its
filtering consistent with the sidebar project filter. Remove this fork change if
upstream makes the picker searchable itself.
