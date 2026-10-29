# ADR 0004: Prefer the thread's checkout when opening PR URLs

- Status: accepted
- Date: 2026-09-21
- Tracking: [Fryuni/t3code#29](https://github.com/Fryuni/t3code/issues/29)
- Compared with upstream: `pingdotgg/t3code` at `58e60bf5e` (2026-10-29)

Upstream opens PR links through a URL-based
[shared opener](../../apps/web/src/lib/openPullRequestLink.ts), which selects the
first project whose repository matches the URL, as decided by each host's client
definition. In the fork, links opened beside
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

Upstream then moved link resolution into the client-runtime's
[`resolveChangeRequestLinkTarget`](../../packages/client-runtime/src/changeRequestLinks.ts),
whose `projectId` is tried first, and mobile passes the project a link came from
([pingdotgg/t3code#24738](https://github.com/pingdotgg/t3code/pull/24738)). That is
this preference, so the fork dropped its own reordering when it synced onto upstream
`6ffde5ba3` and keeps upstream's. The web opener does not pass `projectId` upstream,
so the fork's remaining change is one line: beside a thread, the web passes that
thread's project. Mobile, which now opens PR links in the app too, follows
upstream unchanged. Forgejo instance matching uses the shared rules from
[ADR 0002](0002-forgejo-repository-identity.md), so checkout preference cannot
collapse distinct ports or case-sensitive mounts.

Drop this when upstream's web opener passes the thread's project itself.
