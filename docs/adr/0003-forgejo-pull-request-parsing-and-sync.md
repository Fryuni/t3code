# ADR 0003: Match Forgejo namespaces case-insensitively at the provider boundary

- Status: accepted
- Date: 2026-09-19
- Tracking: [Fryuni/t3code#28](https://github.com/Fryuni/t3code/issues/28)
- Compared with upstream: `pingdotgg/t3code` at `2efb8178d` (2026-09-21)

Upstream's Forgejo provider compares head repository names, head owners, and the
publishing owner with exact string equality. A remote or user input can spell
these differently from the API even though they identify the same Forgejo
namespace. The fork makes those comparisons case-insensitive in the
[provider](../../apps/server/src/sourceControl/ForgejoSourceControlProvider.ts).

For branch PR discovery, exact comparison can discard `Contributor/Repo` when
the selector says `contributor/repo`. Later normalization in GitManager cannot
recover a PR the provider already filtered out. For publishing, spelling the
signed-in user's name differently must still select the user namespace; treating
it as an organization sends the request to the wrong endpoint.

The comparison rule belongs at the provider boundary because it determines what
the Forgejo API returns or where a request is sent. It applies to owner and
repository names, not branch names or web mount paths. Synchronization and stored
link identity use the shared instance-preserving rule from
[ADR 0002](0002-forgejo-repository-identity.md), rather than broadening this
provider-specific case folding to whole paths.
