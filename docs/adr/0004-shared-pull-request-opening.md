# ADR 0004: Prefer the thread's checkout when opening PR URLs

- Status: accepted
- Date: 2026-09-21
- Tracking: [Fryuni/t3code#29](https://github.com/Fryuni/t3code/issues/29)
- Compared with upstream: `pingdotgg/t3code` at `ba0ea3d15` (2026-10-07)

Upstream opens PR links through one URL-based
[shared opener](../../apps/web/src/lib/openPullRequestLink.ts), which selects the
first project whose repository matches the URL. In the fork, links opened beside
a thread prefer that thread's project when it matches the URL.

Repository identity alone cannot choose between two local checkouts of the same
repository. The PR panel treats a PR as the thread's own only when it opened under
the thread's project; under the other checkout, the thread's own PR, including
the rows of its linked-PR list, reads as somebody else's branch. Preferring the
thread's matching project keeps the PR associated with the checkout the user is
working in. This preference applies within the thread's environment, since
project IDs can repeat across environments; it never overrides a repository
mismatch. The fork preserves upstream's environment and capability boundaries
rather than borrowing a matching checkout from another server.

This decision applies to web and desktop, which share the opener. Mobile retains
its external PR-link navigation. Forgejo instance matching uses the shared rules
from [ADR 0002](0002-forgejo-repository-identity.md), so checkout preference cannot
collapse distinct ports or case-sensitive mounts.
