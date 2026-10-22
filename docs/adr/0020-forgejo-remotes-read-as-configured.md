# ADR 0020: Read Forgejo remotes as configured, and keep links off the clone host

- Status: accepted
- Date: 2026-10-17
- Compared with upstream: `pingdotgg/t3code` at `8d3b06112` (2026-10-22)

A checkout can set its remote to the Forgejo web URL and let git push over SSH
through `url.<base>.insteadOf`, for example `https://forge.example/` rewritten to
`ssh://git@forge.tailnet.example/`. `git remote` reports the rewritten SSH URL,
whose host names no `fj` login. `fj` resolves its host from the configured URL,
so `fj whoami` in that checkout names the web instance. T3 read the rewritten
URL, so whether it recognized the repository depended on the advertised-clone
fallback from [ADR 0001](0001-forgejo-discovery-extensions.md). An agent reading
the same remote linked the PR on the SSH host, a host with no Forgejo instance,
so the link opened the wrong address and the watcher never found the PR.

The [Forgejo CLI boundary](../../packages/source-control-forgejo/src/server/ForgejoCli.ts)
reads `remote.<name>.url` with `git config` and prefers it whenever it is an
HTTP URL. Provider-context refinement, discovery, and repository resolution all
use it before matching logins, as `fj` does. A configured shorthand such as
`forge:owner/repo` means nothing until git rewrites it, so in that case the
reported URL still decides. The repository identity's locator keeps the reported
URL: it is what `git remote` and agents see, and
[ADR 0002](0002-forgejo-repository-identity.md) already roots the identity on
the resolved web instance.

Because the answer now depends on the checkout's configuration, the
[provider registry](../../apps/server/src/sourceControl/SourceControlProviderRegistry.ts)
adds the configured URL's server to its unknown-remote cache key. Otherwise a
checkout cloned straight from the SSH alias would cache "unknown" for that host
and hide the instance from an `insteadOf` checkout for five minutes. The key
still drops owner/repo, so one verdict per server remains upstream's design.

The MCP `link_pull_request` and `watch_pull_request` tools also move a link off
the clone host. When a URL names the project's repository on the host of its
SSH remote, and that host differs from the project's change-request host, the
[handler](../../apps/server/src/mcp/toolkits/pullRequests/handlers.ts) links the
same number on the project's host instead. Links to any other repository on that
host are kept as given.

When updating from upstream, keep the configured-URL read ahead of login
matching, the configured server in the registry's cache key, and the clone-host
mapping in the MCP target resolution. Remove either
one if upstream resolves `insteadOf` remotes, or SSH clone hosts in agent links,
itself.
