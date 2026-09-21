# ADR 0004: Pull-request links keep thread context through the shared opener

- Status: accepted
- Date: 2026-09-21
- Tracking: [Fryuni/t3code#29](https://github.com/Fryuni/t3code/issues/29)
- Upstream comparison: `pingdotgg/t3code` at `b44c1ce5d`

The fork keeps one URL-based opening path for supported PR links in web and desktop,
including Git actions. Project selection prefers the thread's own checkout within its
environment. Repository identity alone cannot identify that checkout: two projects can clone
the same repository, and project IDs can repeat across environments.

## Difference from upstream

Upstream's Git actions have a separate `onOpenPullRequest(number)` callback through
`ChatHeader` to `ChatView`, plus a browser fallback. That callback uses the active project's
repository rather than resolving the PR URL, and does not receive the click's modifiers.
The fork removed this path in `44a6ad270`: Git quick actions and menu items now pass their
click event and URL to `useOpenPrLink`, as the result-toast action already does. This gives
these entry points the same internal routing and Cmd/Ctrl-assisted external opening as
sidebar and composer PR links. Markdown uses the underlying `useOpenChangeRequestLink`
before its ordinary-link fallback.

Upstream's shared opener selects the first matching checkout. The fork additionally reads
the target thread's project and prefers it when that project matches the URL (`d9801cf38`).
Removing that preference can associate the panel with another checkout's project even when
the URL is correct. An unrelated thread project must still yield to a matching checkout.

Environment filtering, primary-environment preference for standalone links, capability gates,
and explicit environment selection for standalone panel tabs already exist upstream. They
are retained constraints, not additional fork differences: a thread panel must be served by
its thread's environment, while a standalone tab can carry its own environment. Falling back
to another environment merely because it has the same repository would violate that boundary.

The fork also delegates repository and host matching to the shared identity helpers instead
of upstream's local matching branches. The reasons for preserving Forgejo web authorities and
case-sensitive mount paths belong to [ADR 0002](0002-forgejo-repository-identity.md).

## Decision and evidence

Retain the existing production routing. The redundant Git-actions path is already removed;
removing the checkout preference would reintroduce an observable wrong-project selection.
Do not introduce another resolver or move web navigation into the shared mobile runtime.
Mobile currently opens these PR URLs externally and has separate native navigation; this
decision does not add an internal mobile PR view. No provider adapter or wire contract changes
are needed.

[The behavioral tests](../../apps/web/src/lib/openPullRequestLink.behavior.test.tsx) exercise
the real opening hooks, router, link fallback, and panel store with seeded client state:

- Duplicate checkouts prefer the thread's project for GitHub (including Enterprise), GitLab,
  Forgejo, Bitbucket, and Azure DevOps; sidebar target refs receive the same preference.
- Duplicate project IDs in different environments cannot capture a thread link. Missing
  local matches or unsupported PR reads fall back externally instead of borrowing a server.
- Standalone links prefer a capable primary environment; an explicit source environment is
  preserved on both the standalone tab and its route selection.
- Cmd/Ctrl clicks open buttons externally even with the in-app browser preference, while
  anchors retain their native browser action, across the same source-control providers.

The existing [identity tests](../../apps/web/src/lib/openPullRequestLink.test.ts) cover
Forgejo duplicates separated by HTTP port and mount path. Keep the checkout preference until
upstream's shared opener provides equivalent selection; then remove the fork difference while
retaining the behavioral coverage. Reintroducing the numeric callback would require preserving
URL identity, thread/environment selection, and modifiers in a second path with no present
benefit.
