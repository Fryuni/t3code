# ADR 0003: Forgejo pull-request parsing and synchronization run on upstream's paths

- Status: accepted
- Date: 2026-09-19
- Tracking: [Fryuni/t3code#28](https://github.com/Fryuni/t3code/issues/28)

## Context

Upstream T3 Code reads a pull-request reference in one place: `normalizePullRequestReference`
in [GitManager.ts](../../apps/server/src/git/GitManager.ts) trims it and strips a leading `#`
before any provider sees it, and GitManager is the only caller that hands a reference to a
source-control provider; the pull-request service addresses change requests by number. The
Forgejo provider in
[ForgejoSourceControlProvider.ts](../../apps/server/src/sourceControl/ForgejoSourceControlProvider.ts)
then takes the number from the reference, lists pull requests for a branch by filtering the
API's pages, and publishes a repository under `user/repos` or `orgs/{owner}/repos` depending
on whether the owner is the login. Synchronization — the sync, settlement, and thread
pull-request reactors, the pull-request service, and the web, mobile, and client-runtime
consumers — compares repositories by lower-casing the whole path.

At `upstream/main` (`b44c1ce5d`) the fork differed from that in three provider branches and
in the comparison sites. Only one upstream commit had touched these files since the merge
base, so the fork's diff is its own. The comparison sites were already settled by
[ADR 0002](0002-forgejo-repository-identity.md): they call
`normalizeSourceControlRepository`, which folds owner and name for Forgejo and keeps a
mounted instance path's case. This ADR settles the provider branches and records what the
shared fold changes about synchronization.

## Decision

Reference parsing is upstream's. The provider no longer trims the reference it is given:
GitManager already does, the pull-request thread dialog reaches the provider only through
GitManager, the link dialog and the MCP `link_pull_request` tool turn URLs into link keys with
`parseChangeRequestUrl` and never call the provider, and a trim inside the provider only hid a
caller that forgot. A GitManager-level test now proves the boundary: it hands a padded Forgejo
URL to `resolvePullRequest` and asserts the provider receives it trimmed, so it fails if
GitManager's normalization goes away. Upstream carries no Forgejo provider tests, so nothing in
`ForgejoSourceControlProvider.test.ts` duplicates upstream; the padded-reference assertion was
the one case that belonged at the GitManager boundary and moved there.

The provider keeps two case folds, because Forgejo owner and repository names are
case-insensitive while the API spells them as the server does:

| Retained branch                                                                                    | Why upstream cannot cover it                                                                                                                                                                                                                                                                                                | Regression test                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listChangeRequests` compares the head repository's `full_name` and owner login case-insensitively | The selector's spelling comes from the git remote or the caller, the API's from the server. GitManager folds both sides afterwards in `matchesBranchHeadContext`, but upstream's exact compare drops the pull request before GitManager sees it, so a branch pushed from `contributor/repo` never finds `Contributor/Repo`. | `ForgejoSourceControlProvider.test.ts`: "pages past other forks and closed unmerged PRs before applying the limit", one case per half of the compare |
| `createRepository` compares the owner to the login case-insensitively                              | A user who types their own login in another case would be routed to `orgs/{owner}/repos`, which answers 404 for a user namespace.                                                                                                                                                                                           | `ForgejoSourceControlProvider.test.ts`: "publishes under the login's own namespace only when it owns the repository", both cases                     |

A branch stays only while reverting it to upstream's exact compare makes its named test fail.

Synchronization has no rules of its own. Every comparison site is a consumer of
`normalizeSourceControlRepository`, and two that still lower-cased the whole path now fold
the same way: the URL-unreadable fallback in
[linkCreatedPullRequest.ts](../../apps/server/src/git/linkCreatedPullRequest.ts), whose
repository for a Forgejo identity is the `displayName` and so carries the mount path
(`linkCreatedPullRequest.test.ts`: "folds a Forgejo fallback the way the instance does"),
and the web detail snapshot key in
[pullRequestDetail.logic.ts](../../apps/web/src/components/pullRequest/pullRequestDetail.logic.ts),
where whole-path folding let a snapshot for `forge/acme/web` overwrite the one for
`Forge/acme/web` (`pullRequestDetail.logic.test.ts`: "keeps case-distinct Forgejo mounts
apart"). The shared fold differs from `.toLowerCase()` only for Forgejo paths whose mounts
differ by case; there it keeps two links apart where upstream would treat them as one.

## Consequences

- A provider receives references already normalized. A new caller that reads one from a
  user must go through GitManager or normalize the way it does; the provider will not
  repair padding.
- Sync commands and visible links carry the canonical repository, folded by
  `visibleThreadPullRequests` from ADR 0002, rather than the stored spelling. A thread whose
  link was stored as `Owner/Repository` syncs as `owner/repository`; upstream would emit the
  stored form. `PullRequestSyncReactor.test.ts` ("asks the host once for a pull request shared
  by two threads") pins this.
- When upstream folds head identities or the publish owner inside its Forgejo provider,
  delete the matching row and its test together.
