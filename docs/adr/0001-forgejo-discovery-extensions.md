# ADR 0001: Discover Forgejo SSH remotes from advertised clone URLs

- Status: accepted
- Date: 2026-09-19
- Tracking: [Fryuni/t3code#26](https://github.com/Fryuni/t3code/issues/26)
- Compared with upstream: `pingdotgg/t3code` at `6ffde5ba3` (2026-10-26)

Upstream already discovers Forgejo and Gitea through `fj` and `tea`. The fork
extends that discovery for installations whose SSH clone authority differs from
the configured web authority and has no matching `ssh_host`. Without this
extension, a valid SSH checkout can remain unrecognized despite an authenticated
login for its web instance.

When ordinary login matching fails, the fork asks the configured `fj` instances
for the repository and compares their advertised SSH clone URLs with the remote.
A successful repository lookup alone is insufficient: several instances can host
the same owner/name. Matching the advertised SSH authority and repository path
provides evidence of which instance owns the remote, while ambiguous matches
remain unresolved. This lives in the existing
[CLI discovery boundary](../../packages/source-control-forgejo/src/server/ForgejoCli.ts), so
normal discovery and repository resolution use the same fallback.

The fallback trades authenticated network requests for support of these SSH
layouts. It runs only after ordinary matching fails, bounds the work, and caches
results for one minute.

Upstream now caches unknown-provider refinement in the
[provider registry](../../apps/server/src/sourceControl/SourceControlProviderRegistry.ts)
itself ([pingdotgg/t3code#19692](https://github.com/pingdotgg/t3code/pull/19692)),
which the fork's own registry cache did before. The fork dropped its cache when it
synced onto upstream `b827ca48d` and keeps upstream's. Upstream's key keeps
requested web authorities apart, as the fork's did, but drops the remote's trailing
`owner/repo`, so every repository on one server shares a verdict for five minutes
or until Settings change. This fallback answers per repository, so the first SSH
remote read on a host without a matching `ssh_host` decides for that host: a
repository no login can see leaves the host's other repositories unrecognized until
the verdict expires. The fork accepts that rather than keeping a second cache.

Upstream moved each forge's tests into its own package
([pingdotgg/t3code#24000](https://github.com/pingdotgg/t3code/pull/24000)), and the
server's registry tests now run against fake drivers. The fork's tests for this
fallback and for logins on case-distinct mounts moved to
[`ForgejoSourceControlProvider.test.ts`](../../packages/source-control-forgejo/src/server/ForgejoSourceControlProvider.test.ts).

How the resolved web instance becomes repository identity is a separate decision
in [ADR 0002](0002-forgejo-repository-identity.md).
