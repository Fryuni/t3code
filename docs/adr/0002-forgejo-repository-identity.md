# ADR 0002: Identify Forgejo repositories by their web instance

- Status: accepted
- Date: 2026-09-19
- Tracking: [Fryuni/t3code#27](https://github.com/Fryuni/t3code/issues/27)
- Compared with upstream: `pingdotgg/t3code` at `c77a7b7ee` (2026-10-10)

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

These rules use the existing identity and link contracts, with shared
[normalization](../../packages/shared/src/sourceControl.ts) and
[link matching](../../packages/shared/src/changeRequestUrl.ts). Keeping the rules
shared matters because project selection, credential selection, synchronization,
and clients must agree about repository identity. Separate local fixes would
allow one operation to join instances that another keeps apart. When only an SSH
host is known, matching still leaves the web port and mount to login resolution;
it cannot infer them from the clone address.

For stored links, a URL naming the same PR supplies the repository spelling used
by [link normalization](../../packages/shared/src/threadPullRequests.ts). This
recovers mount case lost in older records before callers copy a key into unlink
or synchronization commands. Without a URL or provider kind, normalization
preserves the prefix and folds only owner/name: losing a case-sensitive mount is
irreversible, while callers that know the provider can apply its complete rule.
The cost is that URL-less references must already carry the correct prefix;
normalization cannot reconstruct missing instance information.
