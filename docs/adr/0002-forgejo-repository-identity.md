# ADR 0002: Identify Forgejo repositories by their web instance

- Status: accepted
- Date: 2026-09-19
- Tracking: [Fryuni/t3code#27](https://github.com/Fryuni/t3code/issues/27)
- Compared with upstream: `pingdotgg/t3code` at `6ffde5ba3` (2026-10-26)

Upstream already records Forgejo web URLs and pull-request authorities, but its
repository comparisons lower-case the entire path and its canonical identity
still comes from the clone remote. That conflates instances mounted at `/Forge`
and `/forge`, and an SSH clone host need not match the web host in a PR URL.
These differences affect which project opens a link and which threads share or
synchronize a pull request.

The fork identifies a resolved Forgejo repository by its web authority and full
repository path, preserving the port and the mount path's case. Only owner and
repository names are lower-cased. The scheme remains in `webUrl` for generating
links; it is not a separate dimension of the canonical key. The
[identity constructor](../../packages/source-control-forgejo/src/server/forgejoRepositoryIdentity.ts)
uses the login-resolved web instance so SSH and HTTP checkouts can agree with PR
links without treating the SSH daemon's address as the web server's address.
Upstream moved Forgejo into `@t3tools/source-control-forgejo` and gave each
driver a `refineRepositoryIdentity` hook, whose Forgejo version sets only
`webUrl`. The fork keeps that hook and has it return this constructor's identity,
so preserve the canonical key and display name when that hook changes upstream.

## Where the rule lives

Upstream made every forge's shared definition parse its own change request URLs,
recognize its own remotes, and name the host its change requests are keyed under
([pingdotgg/t3code#23992](https://github.com/pingdotgg/t3code/pull/23992),
[#23993](https://github.com/pingdotgg/t3code/pull/23993),
[#24181](https://github.com/pingdotgg/t3code/pull/24181),
[#24288](https://github.com/pingdotgg/t3code/pull/24288)). It deleted
`changeRequestUrl.ts`, `pullRequestHostOf`, and nearly all of `sourceControl.ts` in
`@t3tools/shared`. The fork keeps upstream's structure and applies this rule in the
[Forgejo definition](../../packages/source-control-forgejo/src/shared/definition.ts):

- `parseChangeRequestUrl` keeps the mount's case and folds only owner/name.
  Upstream's lower-cases the whole path.
- `changeRequestHost` prefers the resolved `webUrl`'s authority, then an HTTP
  remote's, so an SSH checkout keys on the web port. The core
  `ChangeRequestHostIdentity` type gains `webUrl` for this.
- `isChangeRequestInRepository` and `canReadChangeRequestOnHost` compare the mount
  above owner/name exactly. Upstream's version compares it as a case-insensitive
  prefix, which lets `/git` lend credentials to `/git/other`.

Two helpers stay in [`shared/sourceControl.ts`](../../packages/shared/src/sourceControl.ts),
next to upstream's `isSshRemoteUrl`. `normalizeSourceControlRepository` folds a
path the way its host does: whole for hosts known not to be Forgejo, otherwise
only owner/name. `foldRepositoryKey` applies the same fold to a `host/path` key.
Server comparisons that upstream lower-cases use them. The fork's own
`canonicalRepositoryKey(key, kind)` is gone. Callers use upstream's registry
`canonicalRepositoryKey`, which rewrites Azure's spellings, and the PR page's
project matching and grouping use `foldRepositoryKey`.

GitManager's PR repository key reads the registry's parsed link. For a link with
an authority it returns `authority/repository`, keeping the Forgejo port and mount,
and it skips `_git` repositories, whose Azure DevOps Server remotes key by hostname.
The MCP link tools build a Forgejo URL from the project's resolved `webUrl` origin
when the remote is SSH, so the scheme survives.

Keeping the rules consistent matters because project selection, credential
selection, synchronization, and clients must agree about repository identity.
Separate local fixes would allow one operation to join instances that another
keeps apart. When only an SSH host is known, matching still leaves the web port
and mount to login resolution; it cannot infer them from the clone address.

## Stored links

Upstream moved thread PR key normalization into
[`makeThreadPullRequests`](../../packages/source-control-core/src/shared/threadPullRequests.ts),
which each side binds to its registry. A URL naming the same PR supplies the
repository spelling there. This recovers mount case lost in older records.
Without a URL, a key on a host with several spellings, such as Azure, folds whole.
Otherwise normalization keeps the prefix and folds only owner/name: losing a
case-sensitive mount is irreversible, while callers that know the provider can
apply its complete rule. The cost is that URL-less references must already carry
the correct prefix. Normalization cannot reconstruct missing instance information.

Callers copy keys from visible links into unlink and synchronization commands, so
visible links carry canonical keys. Upstream's `visibleThreadPullRequests` in
`@t3tools/shared` cannot reach a registry and only filters. The factory therefore
returns a `visibleThreadPullRequests` that also canonicalizes keys. The server's
and client-runtime's bound `threadPullRequests` modules export that version.
Modules that import the shared one directly only count or filter links.

Upstream now records the web's shared PR summary observations where list,
detail, and check reads land, keyed by project, repository, and number without
the host. The fork's host dimension, recovered from the summary URL, went with the
old hook. The key folds the repository with `normalizeSourceControlRepository`, so
case-distinct mounts stay apart.

Drop this when upstream's Forgejo identity keeps the web port and the mount's
case.
