# ADR 0007: Show model slug qualifiers in picker labels

- Status: accepted
- Date: 2026-10-04
- Tracking: [Fryuni/t3code#17](https://github.com/Fryuni/t3code/pull/17)
- Compared with upstream: `pingdotgg/t3code` at `ec80933ac` (2026-10-09)

Upstream's model pickers show a model's display name, with a secondary label
naming the provider instance and, when the provider reports one, its
`subProvider`. Providers that route to several vendors, such as OpenCode,
report slugs like `bar`, `foo/bar`, and `openrouter/deepseek/bar`, and catalogs
can prefix a vendor with a dot, as in `azure.bar`. These models often share a
display name and carry no `subProvider`. Upstream now sets `subProvider` for Pi's
discovered models ([pingdotgg/t3code#16661](https://github.com/pingdotgg/t3code/pull/16661)),
which names only the first slug segment, so deeper routes still need the helper. Upstream renders those rows identically,
so the user cannot tell which route a selection dispatches to.

The fork derives the secondary label from the slug in one
[shared helper](../../packages/shared/src/model.ts) (`getModelProviderLabel`).
It adds slash qualifiers that `subProvider` does not already name, and adds a dot
prefix only when the remainder after that prefix matches the model's display name
or short name, or when it is the known `openai.` Codex prefix. Version dots such
as `gpt-5.6` therefore never read as a provider. The web picker row, web picker search,
and mobile model options all use the helper, so a qualifier the user can see is
also one they can search for.

Drop this divergence when upstream's pickers distinguish `bar` from `foo/bar`
without it.
