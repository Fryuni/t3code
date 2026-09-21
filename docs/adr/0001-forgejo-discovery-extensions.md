# ADR 0001: Discover Forgejo SSH remotes from advertised clone URLs

- Status: accepted
- Date: 2026-09-19
- Tracking: [Fryuni/t3code#26](https://github.com/Fryuni/t3code/issues/26)
- Compared with upstream: `pingdotgg/t3code` at `2efb8178d` (2026-09-21)

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
[CLI discovery boundary](../../apps/server/src/sourceControl/ForgejoCli.ts), so
normal discovery and repository resolution use the same fallback.

The fallback trades authenticated network requests for support of these SSH
layouts. It runs only after ordinary matching fails, bounds the work, and caches
results for one minute. The fork also caches unknown-provider refinement by
context values in the
[provider registry](../../apps/server/src/sourceControl/SourceControlProviderRegistry.ts):
status reads create fresh context objects, so object identity would repeat CLI
probes on every read. Requested web authorities remain separate cache inputs to
avoid reusing one instance's result for another. The trade-off is that changed
login or discovery state can take up to a minute to be observed.

How the resolved web instance becomes repository identity is a separate decision
in [ADR 0002](0002-forgejo-repository-identity.md).
