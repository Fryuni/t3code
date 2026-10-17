import { SourceControlProviderKind } from "@t3tools/contracts";
import {
  type ChangeRequestProjectIdentity,
  defineSourceControlClient,
  isChangeRequestOnProjectHost,
  isChangeRequestPath,
} from "@t3tools/source-control-core/client/definition";

const CHECKOUT_COMMAND = /^tea\s+(?:pr|pulls)\s+checkout\s+(.+)$/i;
const CHANGE_REQUEST_REFERENCE =
  /^https?:\/\/[^/\s]+\/(?:[^/\s]+\/)+[^/\s]+\/pulls\/(\d+)(?:[/?#].*)?$/i;

const KIND = SourceControlProviderKind.make("forgejo");

const trimSlashes = (path: string) => path.replace(/^\/+|\/+$/g, "");

/** Everything above a repository path's owner/name segments: the instance's mount, if any. */
const mountOf = (path: string) => trimSlashes(path).split("/").slice(0, -2).join("/");

/**
 * Whether two repository paths below one web authority name the same repository. Forgejo folds
 * owner and name, but a mount path is the reverse proxy's and keeps its case, so `/Forge` and
 * `/forge` can be different instances.
 */
function sameRepositoryPath(left: string, right: string): boolean {
  const ownerAndName = (path: string) => trimSlashes(path).split("/").slice(-2).join("/");
  return (
    mountOf(left) === mountOf(right) &&
    ownerAndName(left).toLowerCase() === ownerAndName(right).toLowerCase()
  );
}

/**
 * The repository's browser URL the server resolved from the signed-in account, which is the
 * only place a Forgejo mounted below a path says so.
 */
function resolvedWebUrl(identity: ChangeRequestProjectIdentity): URL | null {
  if (!identity.webUrl) return null;
  try {
    const url = new URL(identity.webUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** An HTTP clone remote, which names the web origin and mount when no web URL was resolved. */
function httpRemoteUrl(identity: ChangeRequestProjectIdentity): URL | null {
  try {
    const url = new URL(identity.locator.remoteUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Whether a link is on the project's Forgejo instance: its web authority and exact mount. An
 * identity that only knows an SSH clone host, or a link without an authority, compares
 * hostnames, leaving the port and mount to the signed-in login.
 */
function isOnProjectInstance(
  identity: ChangeRequestProjectIdentity,
  link: Parameters<typeof isChangeRequestOnProjectHost>[2],
): boolean {
  const known = resolvedWebUrl(identity) ?? httpRemoteUrl(identity);
  if (!known || link.authority === undefined) {
    return isChangeRequestOnProjectHost(KIND, identity, link);
  }
  return (
    known.host.toLowerCase() === link.authority.toLowerCase() &&
    mountOf(known.pathname) === mountOf(link.repository)
  );
}

export const definition = defineSourceControlClient({
  kind: KIND,
  label: "Forgejo",
  pickerLabel: "Forgejo / Gitea",
  icon: "forgejo",
  changeRequest: { shortLabel: "PR", singular: "pull request" },
  repositoryPathHint: "owner/repo",
  // Forgejo and Gitea are self-hosted, so no hostname names them.
  publicHost: null,
  publishDescription: "Your signed-in server",
  publishHost: (signedInHost) => signedInHost ?? "your server",
  newRepositoryOwner: (account) => (account ? { owner: account } : null),
  defaultCloneTransport: "https",
  // The server's resolved web URL wins; otherwise an HTTP remote on the same host names the
  // origin, which may carry a port. SSH remotes say nothing about the web origin.
  changeRequestUrl: ({ host, repository, number, remoteUrl, webUrl }) => {
    if (webUrl) return `${webUrl.replace(/\/+$/, "")}/pulls/${number}`;
    try {
      const remote = new URL(remoteUrl ?? "");
      if (
        (remote.protocol === "http:" || remote.protocol === "https:") &&
        (remote.hostname.toLowerCase() === host.toLowerCase() ||
          remote.host.toLowerCase() === host.toLowerCase())
      ) {
        return `${remote.origin}/${repository}/pulls/${number}`;
      }
    } catch {}
    return `https://${host}/${repository}/pulls/${number}`;
  },
  changeRequestActions: new Set(["merge", "close", "reopen", "update-branch"] as const),
  // Neither `fj` nor `tea` checks out by number, so fetch the pull ref from the repository itself.
  checkoutCommand: ({ number, repositoryUrl }) =>
    repositoryUrl
      ? `git fetch '${repositoryUrl.replaceAll("'", "'\\''")}' refs/pull/${number}/head && git checkout -B pulls/${number} FETCH_HEAD`
      : null,
  authorProfileUrl: () => null,
  // Forgejo refuses a change request review without a summary, even with inline comments.
  referenceAutolinkRepositoryUrl: () => null,
  reviewSummaryRequired: (verdict) => verdict === "request-changes",
  checkoutCommandArgument: (input) => CHECKOUT_COMMAND.exec(input)?.[1]?.trim() ?? null,
  isChangeRequestReference: (url) => CHANGE_REQUEST_REFERENCE.test(url),
  changeRequestUrlHost: (url) => url.host,
  checkoutChangeRequestHost: () => null,
  // The repository is the resolved web URL's path, which carries the mount an SSH remote lacks.
  isChangeRequestInRepository: (identity, link) => {
    const web = resolvedWebUrl(identity);
    const repository = web
      ? trimSlashes(web.pathname)
      : (identity.displayName ??
        (identity.owner && identity.name ? `${identity.owner}/${identity.name}` : null));
    return (
      repository !== null &&
      sameRepositoryPath(repository, link.repository) &&
      isOnProjectInstance(identity, link)
    );
  },
  // A server mounted below a path serves only repositories under that mount.
  canReadChangeRequestOnHost: isOnProjectInstance,
  isChangeRequestUrl: (url) => isChangeRequestPath(url, "/pulls/"),
});
