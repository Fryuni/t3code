# ADR 0001: Forgejo remote discovery extends the upstream pipeline

- Status: accepted
- Date: 2026-09-19
- Tracking: [Fryuni/t3code#26](https://github.com/Fryuni/t3code/issues/26)

## Context

Upstream T3 Code discovers Forgejo and Gitea remotes through the shared
`managed-cli` discovery spec in
[SourceControlProviderDiscovery.ts](../../apps/server/src/sourceControl/SourceControlProviderDiscovery.ts),
driven by the `fj` and `tea` CLIs. That spec, the Forgejo `makeDiscovery` spec
built on it, and `matchForgejoLogin` are identical between this fork and
`upstream/main` at `a8693eb4e`.

The fork predates upstream's Forgejo support and once carried a parallel
discovery path. After several upstream merges, that path had converged, but
four fork-only branches remained inside the shared pipeline. This ADR records
which branches stay, why upstream cannot stand in for them, and the test that
proves each one is load-bearing.

## Decision

Forgejo and Gitea remotes run on upstream's discovery pipeline with no parallel
fork path. The fork retains exactly the following extensions inside that
pipeline. A branch stays only while removing it makes its named test fail.

| Retained branch                                                                                                                                                                | Why upstream cannot cover it                                                                                                                                                                                                                                                                                                                                                                    | Regression test                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseForgejoRemote` trims its input ([ForgejoCli.ts](../../apps/server/src/sourceControl/ForgejoCli.ts))                                                                      | Pasted references arrive padded. Without the trim the padding reaches the URL parser and the scp-form pattern, which read it into the host, user, or path segment and produce a wrong or empty parse.                                                                                                                                                                                           | `SourceControlDiscovery.test.ts`: "parses Forgejo remotes padded by whitespace"                                                                                               |
| `listLogins` advertised-clone fallback and `sshRemoteCache` ([ForgejoCli.ts](../../apps/server/src/sourceControl/ForgejoCli.ts))                                               | An instance whose SSH clone authority differs from its web authority has no `ssh_host` match, so upstream resolves nothing. The fallback asks each login's server for the repository and requires the advertised `ssh_url` host and path to match the remote. A bare repository lookup is not evidence, because the same owner/name can exist on several servers.                               | `SourceControlDiscovery.test.ts`: "discovers advertised Forgejo SSH remotes: matching" plus the `wrong-path`, `wrong-port`, `ambiguous`, and `unavailable` negative scenarios |
| `resolveTarget` retries `listLogins` with the raw SSH remote URL ([ForgejoCli.ts](../../apps/server/src/sourceControl/ForgejoCli.ts))                                          | The first pass deliberately passes the web base URL so HTTP-origin detection works and so the expensive probe is skipped whenever a plain `ssh_host` match suffices. The retry is the only way repository resolution reaches the fallback above.                                                                                                                                                | `SourceControlDiscovery.test.ts`: "discovers advertised Forgejo SSH remotes: matching"                                                                                        |
| `RemoteRefinementKey`, `remoteRefinementCache`, and `refineContext` ([SourceControlProviderRegistry.ts](../../apps/server/src/sourceControl/SourceControlProviderRegistry.ts)) | Upstream calls `refineUnknownRemoteProvider` directly whenever a caller supplies an explicit context. Status reads supply a fresh context object on every read, so that path re-ran the external `fj`/`tea` probe each time. Keying the cache by the context's values lets status reads and default-remote discovery share one probe while keeping distinct requested web authorities separate. | `SourceControlProviderRegistry.test.ts`: "shares cached refinement while keeping requested web authorities separate"                                                          |

The fork-only `ForgejoCli.test.ts` was removed. Its login-matching assertions
duplicated upstream's "does not choose a default Forgejo login across ambiguous
SSH server ports", which already covers nondefault ports, SSH aliases,
`requestedHost`, and host-only remotes. The two assertions it uniquely carried
moved into `SourceControlDiscovery.test.ts`: the padded-input parse above, and
"keeps case-distinct mounted Forgejo instances separate when selecting a login".
The latter guards upstream behavior rather than a fork branch, but the fork's
[normalizeSourceControlRepository](../../packages/shared/src/sourceControl.ts)
exists specifically to preserve instance-path case, so the distinction needs a
test that fails if login matching ever starts folding it.

## Consequences

- The refinement cache is provider-agnostic. It applies to every remote whose
  provider kind is `unknown`, which includes self-hosted GitLab and similar
  hosts, not only Forgejo. Its TTL is one minute, longer than the five-second
  provider-context cache upstream keys by checkout, because the cached value is
  the outcome of an authenticated CLI probe rather than a `git remote` read.
- The advertised-clone probe costs one authenticated API call per configured
  login, bounded by a five-second timeout each and a concurrency of three. It
  runs only after a plain `ssh_host` match fails, and its results are cached for
  one minute per checkout and remote URL.
- When upstream gains an equivalent capability, delete the branch and its
  regression test together and update the table above. A branch whose test no
  longer fails when the branch is removed is no longer load-bearing and should
  go.

## Out of scope

Repository identity — the shared `canonicalRepositoryKey` normalization that
preserves instance-path case, PR reference parsing, and link matching — is
decided in [ADR 0002](0002-forgejo-repository-identity.md). The Forgejo
publishing option in the web Git actions remains open; see
[fork-upstream-differences.md](../internals/fork-upstream-differences.md).
