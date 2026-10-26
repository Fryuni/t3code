import { SourceControlProviderKind } from "@t3tools/contracts";
import { normalizeSourceControlRepository } from "@t3tools/shared/sourceControl";
import {
  changeRequestUrlBelow,
  type ChangeRequestHostIdentity,
  type ChangeRequestProjectIdentity,
  defineSourceControl,
  isChangeRequestOnProjectHost,
  parseChangeRequestPath,
  projectChangeRequestHost,
  remoteWebOrigin,
} from "@t3tools/source-control-core/shared/definition";
import { icon } from "./icon.ts";

const CHECKOUT_COMMAND = /^tea\s+(?:pr|pulls)\s+checkout\s+(.+)$/i;
const CHANGE_REQUEST_REFERENCE =
  /^https?:\/\/[^/\s]+\/(?:[^/\s]+\/)+[^/\s]+\/pulls\/(\d+)(?:[/?#].*)?$/i;

// Forgejo and Gitea run on any hostname, possibly mounted below a path.
const CHANGE_REQUEST_PATH = /^\/([^/]+(?:\/[^/]+)+)\/pulls\/(\d+)(?:\/|$)/u;

const KIND = SourceControlProviderKind.make("forgejo");

const changeRequestHeadRef = (number: number) => `refs/pull/${number}/head`;

const trimSlashes = (path: string) => path.replace(/^\/+|\/+$/g, "");

/** Everything above a repository path's owner/name segments: the instance's mount, if any. */
const mountOf = (path: string) => trimSlashes(path).split("/").slice(0, -2).join("/");

/** Forgejo folds owner and name, but a mount belongs to the proxy, so `/Forge` and `/forge` differ. */
function sameRepositoryPath(left: string, right: string): boolean {
  const ownerAndName = (path: string) => trimSlashes(path).split("/").slice(-2).join("/");
  return (
    mountOf(left) === mountOf(right) &&
    ownerAndName(left).toLowerCase() === ownerAndName(right).toLowerCase()
  );
}

function httpUrl(value: string | undefined): URL | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** A server's identity includes its port: the resolved web URL names it best, an HTTP remote next. */
function changeRequestHost(identity: ChangeRequestHostIdentity): string {
  const known = httpUrl(identity?.webUrl) ?? httpUrl(identity?.locator?.remoteUrl);
  return known?.host.toLowerCase() ?? projectChangeRequestHost(identity, KIND);
}

/**
 * Whether a link is on the project's instance: its web authority and exact mount. With only an
 * SSH clone host, or a link without an authority, hostnames decide and the login resolves the rest.
 */
function isOnProjectInstance(
  identity: ChangeRequestProjectIdentity,
  link: Parameters<typeof isChangeRequestOnProjectHost>[2],
): boolean {
  const known = httpUrl(identity.webUrl) ?? httpUrl(identity.locator.remoteUrl);
  if (!known || link.authority === undefined) {
    return isChangeRequestOnProjectHost(changeRequestHost(identity), identity, link);
  }
  return (
    known.host.toLowerCase() === link.authority.toLowerCase() &&
    mountOf(known.pathname) === mountOf(link.repository)
  );
}

export const definition = defineSourceControl({
  kind: KIND,
  label: "Forgejo",
  pickerLabel: "Forgejo / Gitea",
  icon,
  searchKeywords: ["gitea", "tea", "codeberg"],
  changeRequest: {
    shortLabel: "PR",
    shortLabelWithArticle: "a PR",
    singular: "pull request",
    plural: "pull requests",
  },
  repositoryPathHint: "owner/repo",
  // Codeberg is the public Forgejo; any other server is self-hosted.
  publicHost: "codeberg.org",
  publishDescription: "Your signed-in server",
  publishHost: (signedInHost) => signedInHost ?? "your server",
  newRepositoryOwner: (account) => (account ? { owner: account } : null),
  defaultCloneTransport: "https",
  // The server's resolved web URL wins; otherwise an HTTP remote on the same host names the
  // origin, which may carry a port. SSH remotes say nothing about the web origin.
  changeRequestUrl: ({ host, repository, number, remoteUrl, webUrl }) =>
    webUrl
      ? changeRequestUrlBelow(webUrl, `pulls/${number}`)
      : `${remoteWebOrigin(host, remoteUrl)}/${repository}/pulls/${number}`,
  // A server's identity includes its port, so the link carries it.
  parseChangeRequestUrl: (url) => {
    const link = parseChangeRequestPath(url, CHANGE_REQUEST_PATH);
    const path = CHANGE_REQUEST_PATH.exec(url.pathname)?.[1];
    return link === null || path === undefined
      ? null
      : {
          ...link,
          // A mount keeps its case, since it can tell two instances on one host apart.
          repository: normalizeSourceControlRepository(path, KIND),
          authority: url.host.toLowerCase(),
        };
  },
  changeRequestUrlFromReferenceAutolink: () => null,
  changeRequestActions: new Set(["merge", "close", "reopen", "update-branch"] as const),
  // Neither `fj` nor `tea` checks out by number.
  checkoutCommand: ({ number, repositoryUrl }) =>
    repositoryUrl
      ? `git fetch '${repositoryUrl.replaceAll("'", "'\\''")}' ${changeRequestHeadRef(number)} && git checkout -B pulls/${number} FETCH_HEAD`
      : null,
  changeRequestCloseCommand: /\b(?:tea\s+(?:pr|pulls)|fj\s+pr)\s+(?:merge|close)\b/u,
  authorProfileUrl: () => null,
  // Forgejo refuses a change request review without a summary, even with inline comments.
  reviewSummaryRequired: (verdict) => verdict === "request-changes",
  checkoutCommandArgument: (input) => CHECKOUT_COMMAND.exec(input)?.[1]?.trim() ?? null,
  isChangeRequestReference: (url) => CHANGE_REQUEST_REFERENCE.test(url),
  checkoutChangeRequestHost: () => null,
  changeRequestHeadRef,
  recognizeRemote: ({ remoteUrl, host, hostname }) =>
    hostname === "codeberg.org" ||
    hostname.split(".").includes("forgejo") ||
    hostname.split(".").includes("gitea")
      ? {
          kind: KIND,
          name: "Forgejo",
          baseUrl: /^https?:/iu.test(remoteUrl) ? new URL(remoteUrl).origin : `https://${host}`,
        }
      : null,
  changeRequestHost,
  // The web URL resolved from the signed-in account carries the mount an SSH remote lacks.
  isChangeRequestInRepository: (identity, link) => {
    const web = httpUrl(identity.webUrl);
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
});
