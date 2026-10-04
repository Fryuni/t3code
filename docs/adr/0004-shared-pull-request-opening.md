# ADR 0004: Open PR URLs through one path and prefer the thread's checkout

- Status: accepted
- Date: 2026-09-21
- Tracking: [Fryuni/t3code#29](https://github.com/Fryuni/t3code/issues/29)
- Compared with upstream: `pingdotgg/t3code` at `2efb8178d` (2026-09-21)

Upstream's Git actions open a PR through a separate numeric callback associated
with the active project. Its shared URL opener selects the first matching
checkout. In the fork, Git actions use the same URL-based opener as other PR
links, and links opened beside a thread prefer that thread's project when it
matches the URL.

A PR number is meaningful only within its repository. Passing the URL and click
event through the [shared opener](../../apps/web/src/lib/openPullRequestLink.ts)
preserves that identity and Cmd/Ctrl external-opening behavior across entry
points. A second Git-actions path would have to duplicate both rules and could
route the same link differently depending on where it was clicked.

Repository identity alone also cannot choose between two local checkouts of the
same repository. Preferring the thread's matching project keeps the PR panel
associated with the checkout the user is working in. This preference applies
within the thread's environment, since project IDs can repeat across
environments; it never overrides a repository mismatch. The fork preserves
upstream's environment and capability boundaries rather than borrowing a
matching checkout from another server.

This decision applies to web and desktop, which share the opener. Mobile retains
its external PR-link navigation. Forgejo instance matching uses the shared rules
from [ADR 0002](0002-forgejo-repository-identity.md), so checkout preference cannot
collapse distinct ports or case-sensitive mounts.
