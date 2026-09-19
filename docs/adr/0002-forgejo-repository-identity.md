# ADR 0002: Forgejo repository identity is upstream's key, folded per host

- Status: accepted
- Date: 2026-09-19
- Tracking: [Fryuni/t3code#27](https://github.com/Fryuni/t3code/issues/27)

## Context

Upstream T3 Code identifies a repository by one string, `RepositoryIdentity.canonicalKey`,
built by `normalizeGitRemoteUrl`: the remote's hostname, lower-cased, followed by the
repository path, lower-cased, with no scheme and no port. Pull-request links are compared
the same way: `ThreadPullRequestKey` and `PullRequestRef` hold a host and a repository
path, and every comparison lower-cases both. Upstream already treats Forgejo specially in
two places: `parseChangeRequestUrl` records the web `authority` (host and port) of a
`/pulls/` link, and the identity resolver in `server.ts` attaches a login-resolved
`webUrl` to a Forgejo identity. At `upstream/main` (`dfbb11bdd`) that is the whole model.

That model is wrong for Forgejo in ways the fork's users hit:

- **Instances share hostnames.** A Forgejo instance is addressed by scheme, host, port,
  and an optional mount path (`https://example.com/forgejo`). Two instances can differ
  only by port or by mount path, and the mount path belongs to whatever proxy serves it,
  so its case can be significant. Lower-casing the whole path folds `/Forge/owner/repo`
  and `/forge/owner/repo` together; dropping the port folds two servers together.
- **SSH remotes do not name the instance.** A clone over `ssh.example.test:2222` says
  nothing about the web instance's host, port, scheme, or mount. Upstream's canonical key
  for such a checkout is the SSH host and path, which never equals the key read from a
  pull-request URL, so links, settlement, and stacking cannot match the project.

The fork had answered both, but the answers had spread: a `normalizeSourceControlRepository`
call replacing each of fifteen `.toLowerCase()` sites, a hand-built canonical key in
`server.ts`, a Forgejo branch inside `GitManager.pullRequestRepositoryKey`, and three
copies of "does this link belong to this identity" (web project lookup, legacy single-link
projection, and host-level credential lending), each reading the web authority from the
remote URL on its own. Mobile and client-runtime still lower-cased. This ADR settles what
the identity model is and where its rules live.

## Decision

The identity stays upstream's: one `canonicalKey` string, `ChangeRequestLink` with its
optional `authority`, `ThreadPullRequestKey` as host, repository, number. No new type is
introduced. The fork's rules are expressed as three shared helpers and one server
constructor, and every comparison site calls them instead of folding on its own.

**Fold the way the host folds.** `normalizeSourceControlRepository(repository, kind)` in
[sourceControl.ts](../../packages/shared/src/sourceControl.ts) lower-cases the whole path
for GitHub, GitLab, Bitbucket, and Azure DevOps, and only the last two segments (owner and
name) for Forgejo. Without a kind, or with `unknown`, it also folds only the last two: that
is the one part every host folds, and the rest is trusted as written. `canonicalRepositoryKey`
applies the same rule below a lower-cased host and keeps the port.

**A link's URL decides its fold.** `normalizeThreadPullRequestKey` in
[threadPullRequests.ts](../../packages/shared/src/threadPullRequests.ts) parses the link's
URL when it has one; if that URL names the same change request, its repository and
authority are taken as parsed, so a GitLab path folds whole and a Forgejo path keeps its
mount case and web port. Whether the URL is about the key's repository is judged
case-insensitively over the whole path, so a URL and a stored repository that differ only
in mount case are the same link, and the URL's spelling wins. A key with neither URL nor
kind keeps the owner/name fold. This is deliberately not "fold everything unless proven
Forgejo": unlink commands and linked-thread lookups carry no URL and copy the repository
from a stored link, so folding them further would stop them matching the link they came
from on an upper-cased mount. Before exposing stored links to these callers,
`visibleThreadPullRequests` recovers their canonical keys from their URLs. This matters for
legacy records whose stored mount spelling or GitLab group case differs from the URL:
copying the unnormalized fields would produce a command that cannot match its own link.

**One matcher for links against identities.** `changeRequestLinkOnRepositoryInstance` and
`changeRequestLinkMatchesRepository` in
[changeRequestUrl.ts](../../packages/shared/src/changeRequestUrl.ts) decide whether a
parsed link is on an identity's instance, and whether it names its repository. For a
Forgejo link the identity's web authority is read from `webUrl` first, then an HTTP
remote. Both carry the repository path, so their mount is everything before owner/name
and must match the link's mount exactly, including case. A root mount is not a wildcard,
and a nested mount can serve a separate instance. An identity that knows only an SSH clone
host compares hostnames and leaves ports and mounts to the login. The web project lookup, host-level credential lending, and the
legacy single-link projection all call these; their local copies are gone.

**Forgejo identities are re-rooted on the instance.** `forgejoRepositoryIdentity` in
[forgejoRepositoryIdentity.ts](../../apps/server/src/sourceControl/forgejoRepositoryIdentity.ts)
rewrites a refined identity's `canonicalKey` to the web authority plus the repository's
path below the web origin (mount path as written, owner and name folded), sets
`displayName` to that path, and keeps the scheme in `webUrl`. Upstream's refine sets only
`webUrl` and leaves the SSH-derived key in place.

**Generated links take the scheme from `webUrl`.** `changeRequestUrlFor` accepts the
identity's `webUrl` after the remote URL and prefers it, so an SSH checkout of an
HTTP-only instance links to `http://`. Upstream only reads the remote, which for SSH says
nothing, and falls back to `https://`. For the same reason `pullRequestHostOf` in contracts
reads `webUrl` before an HTTP remote, so a project's host is the resolved web authority
even when its remote reaches the instance on another port; without that, the link builder
would be handed the remote's port and reject the `webUrl` as belonging to another host.

### Retained rules and their tests

| Rule                                                                                                                                      | What upstream does instead                                                                                             | Regression test                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizeSourceControlRepository` and `canonicalRepositoryKey(key, kind)` fold owner/name only for Forgejo, unknown, and kind-less input | `canonicalRepositoryKey(key)` takes no kind; every site lower-cases the whole path                                     | `sourceControl.test.ts`: "normalizes repository names without losing Forgejo instance path case"; `threadPullRequests.test.ts`: "keeps instance paths case-sensitive while folding owner and repository names"                                                                                                             |
| `parseChangeRequestUrl` folds a `/pulls/` repository with the Forgejo rule                                                                | Lower-cases the whole path                                                                                             | `changeRequestUrl.test.ts`: "reads the Forgejo instance and repository from %s"                                                                                                                                                                                                                                            |
| `normalizeThreadPullRequestKey` takes the fold from the link's URL when it names the same change request                                  | Recovers only the authority from the URL; lower-cases the repository                                                   | `threadPullRequests.test.ts`: "lets a link's URL decide how much of the path its host folds"                                                                                                                                                                                                                               |
| `changeRequestLinkOnRepositoryInstance` and `changeRequestLinkMatchesRepository` are the only link-to-identity comparison                 | Web-local `resolvedForgejoRepository` and `matchesChangeRequestAuthority`; a third copy in `legacyLinkedPullRequestOf` | `changeRequestUrl.test.ts`: the `changeRequestLinkMatchesRepository` block; `openPullRequestLink.test.ts`: "selects the Forgejo HTTP port…", "lets tea resolve the web port…", "matches Forgejo instance paths by case"; `threadPullRequests.test.ts`: "routes Forgejo links through the identity's resolved web instance" |
| `forgejoRepositoryIdentity` re-roots `canonicalKey` and `displayName` on the web instance                                                 | Refine sets `webUrl` only                                                                                              | `forgejoRepositoryIdentity.test.ts` (all four cases); the resolver layer in `server.ts` that calls it is wiring and is not unit-tested                                                                                                                                                                                     |
| `pullRequestRepositoryKey` reads a Forgejo link through `parseChangeRequestUrl` so the key is the web authority and mount path            | No `/pulls/` handling; the key would be the lower-cased, portless URL host and path                                    | `GitManager.test.ts`: the `pullRequestRepositoryKey` cases for `git.example.test/Forge/owner/repo` and `git.example.test:8443/owner/repo`                                                                                                                                                                                  |
| `changeRequestUrlFor` prefers the identity's `webUrl` origin, then a matching HTTP remote                                                 | Reads the remote only                                                                                                  | `changeRequestUrl.test.ts`: "prefers the resolved web URL's origin over the remote %s", "ignores a resolved web URL on another authority"                                                                                                                                                                                  |
| `pullRequestHostOf` reads a Forgejo identity's `webUrl` before its HTTP remote                                                            | Reads the remote only                                                                                                  | `pullRequest.test.ts` (contracts): "separates Forgejo HTTP ports while preserving other provider host identities"                                                                                                                                                                                                          |
| `listLinkedPullRequestThreads` compares the stored repository as written and post-filters with `threadPullRequestKeysEqual`               | Compares against the lower-cased key                                                                                   | `linkedThreads.test.ts`: the `upper-instance` and `lower-instance` fixtures                                                                                                                                                                                                                                                |
| `changeRequestRepositoryUrl` matches `/pulls/` greedily so a mount path containing `pull` is kept                                         | One lazy pattern for every host                                                                                        | `changeRequestUrl.test.ts`: "extracts the repository root from %s"                                                                                                                                                                                                                                                         |
| `ForgejoSourceControlProvider` trims a pasted reference and compares head owner and repository case-insensitively                         | Exact string compares                                                                                                  | `ForgejoSourceControlProvider.test.ts`: "preserves fork identity and draft status for a normalized PR URL", "pages past other forks and closed unmerged PRs before applying the limit"                                                                                                                                     |

The `.toLowerCase()` replacements in `PullRequestService`, `ThreadSettlementReactor`,
`ThreadPullRequestReactor`, the MCP pull-request toolkit, the web pull-request state and
components, mobile `queries.ts`, and client-runtime `pullRequestRouting.ts` are consumers
of the first rule, not rules of their own. Where the provider kind is in scope
(`project.api.kind`) it is passed; the rest are keyed by project and fold owner/name.

## Consequences

- A key with no URL and no kind cannot tell two mounts apart beyond what its repository
  string says. `listLinkedPullRequestThreads` for `Forge/acme/web` finds only threads
  linked under `Forge/…`, which is the stored spelling; a caller that lower-cased the mount
  itself would find the other instance. User-facing callers copy the normalized visible
  link, so they carry the spelling recovered from its URL.
- Kind-less, URL-less GitLab keys keep their group case. Every stored link has a URL and
  visible links normalize that case before callers drop the URL. Other URL-less references
  still need to carry the canonical spelling; their provider cannot be inferred from the
  repository path alone.
- `canonicalKey` for a refined Forgejo identity is now folded (owner and name lower-cased)
  where it was previously the remote's spelling. Every comparison already went through
  `canonicalRepositoryKey`, so nothing observable changes; the key is simply canonical.
- Mobile and client-runtime fold the same way as the server and web. Their inputs are
  server-produced and already folded, so this is consistency rather than a fix.
- Resolve upstream normalization changes toward the shared helpers. If upstream gains
  per-host folding or re-roots Forgejo identities itself, delete the matching row above
  together with its test.
