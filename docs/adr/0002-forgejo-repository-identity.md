# ADR 0002: Identify Forgejo repositories by their web instance

- Status: accepted
- Date: 2026-09-19
- Tracking: [Fryuni/t3code#27](https://github.com/Fryuni/t3code/issues/27)
- Compared with upstream: `pingdotgg/t3code` at `2547fb284` (2026-11-28)

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
  remote's, so an SSH checkout keys on the web port. **Implemented upstream:**
  [pingdotgg/t3code#29784](https://github.com/pingdotgg/t3code/pull/29784) made
  Forgejo's `changeRequestHost` do the same and added `webUrl` to the core
  `ChangeRequestHostIdentity`, so the fork keeps upstream's field. The fork's
  `changeRequestHost` is behaviorally upstream's; it stays written over the `httpUrl`
  helper the instance checks below share.
- `isChangeRequestInRepository` and `canReadChangeRequestOnHost` compare the mount
  above owner/name exactly. Upstream's version compares it as a case-insensitive
  prefix, which lets `/git` lend credentials to `/git/other`.
- `parseCommitUrl` reads the repository and authority as `parseChangeRequestUrl`
  does. Upstream added commit links, which open in the thread's Diff pane when
  `isChangeRequestInRepository` accepts them
  ([pingdotgg/t3code#19941](https://github.com/pingdotgg/t3code/pull/19941)). Its
  `parseCommitPath` lower-cases the whole path, so the exact mount check above would
  otherwise reject a commit on `/Forge` and accept it on `/forge`.

Two helpers stay in [`shared/sourceControl.ts`](../../packages/shared/src/sourceControl.ts),
next to upstream's `isSshRemoteUrl`. `normalizeSourceControlRepository` folds a
path the way its host does: whole for hosts known not to be Forgejo, otherwise
only owner/name. `foldRepositoryKey` applies the same fold to a `host/path` key.
Server comparisons that upstream lower-cases use them. The fork's own
`canonicalRepositoryKey(key, kind)` is gone. Callers use upstream's registry
`canonicalRepositoryKey`, which rewrites Azure's spellings, and the PR page's
project matching and grouping use `foldRepositoryKey`. Upstream moved the PR
page's project filter into client-runtime's `pullRequestProjectFilter.ts` and
shares it with mobile
([pingdotgg/t3code#25219](https://github.com/pingdotgg/t3code/pull/25219)); the
fold moved with it.

Upstream then gave repository paths one spelling however they are percent-encoded,
through `canonicalRepositoryPath` in `@t3tools/shared/git`
([pingdotgg/t3code#36929](https://github.com/pingdotgg/t3code/pull/36929)). It
lower-cases the whole path, and the registry's `canonicalRepositoryKey` now applies it
to every key no host claims. The fork keeps upstream's helper but applies it only to
the segments it folds: `normalizeSourceControlRepository` and the Forgejo owner/name
comparison canonicalize owner and name with it, and an unclaimed key folds with
`foldRepositoryKey`, so a mount keeps its case and its spelling as written. A mount
spelled with different percent-encodings therefore still reads as two instances.

Upstream's Forgejo issue links
([pingdotgg/t3code#19261](https://github.com/pingdotgg/t3code/pull/19261)) key an issue by its
lower-cased repository path, as every tracker does. The fork does not extend this rule to
issues, so two case-distinct mounts on one host share issue keys. Issue reads go through the
same Forgejo CLI boundary as pull requests, so they resolve the instance as above. Upstream now
also reads an issue link on a self-hosted hostname when a Forgejo project on that host vouches for
it ([pingdotgg/t3code#40271](https://github.com/pingdotgg/t3code/pull/40271)); the fork keeps that
beside its own `parseChangeRequestUrl`.

GitManager's PR repository key reads the registry's parsed link. For a link with
an authority it returns `authority/repository`, keeping the Forgejo port and mount,
and it skips `_git` repositories, whose Azure DevOps Server remotes key by hostname.
The MCP link and watch tools'
[target resolver](../../apps/server/src/pullRequest/pullRequestTarget.ts) builds a Forgejo URL
from the project's resolved `webUrl` origin when the remote is SSH, so the scheme survives.
Upstream's resolver now reads an Azure DevOps bare repository name through the project's own
key ([pingdotgg/t3code#41472](https://github.com/pingdotgg/t3code/pull/41472)) and lower-cases the
result; the fork folds it with `normalizeSourceControlRepository` instead, so a mount keeps its case.

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
the host. A project can read change requests on another host through another
checkout or a public host, so the fork keeps the reference's host in that key.
Legacy thread links recover theirs from the URL, which keeps the web port. The
repository folds with `normalizeSourceControlRepository`, so case-distinct mounts
stay apart.

Upstream's PR service now reads every repository a multi-repository project tracks, and
matches a reference and its line counts by host and lower-cased repository
([pingdotgg/t3code#44399](https://github.com/pingdotgg/t3code/pull/44399)). The fork keeps that
matching and folds the repository with `normalizeSourceControlRepository` instead. The web
PR panel's legacy-link check, which upstream now lower-cases too, folds the same way. Upstream
also keeps a mounted Forgejo project's scheme and port in a PR's fallback URL when the
repository matches its `webUrl` path
([pingdotgg/t3code#44521](https://github.com/pingdotgg/t3code/pull/44521)), but that path is
lower-cased, so the fork's rules above still apply.

Upstream's client patches PR readers from the host's reply to an action
([pingdotgg/t3code#25761](https://github.com/pingdotgg/t3code/pull/25761)) and matches them
by a lower-cased repository. Those references carry no provider, so the fork keeps that
match: only one project reading PRs from both `Forge/o/r` and `forge/o/r` on one host could
patch the wrong reader, until its next read.

Drop this when upstream's Forgejo identity keeps the web port and the mount's
case.
