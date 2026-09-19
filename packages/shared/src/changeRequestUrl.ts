import {
  pullRequestHostOf,
  type RepositoryIdentity,
  type SourceControlProviderKind,
  type ThreadLinkedPullRequest,
} from "@t3tools/contracts";
import {
  canonicalRepositoryKey,
  normalizeSourceControlRepository,
  sourceControlRepositorySelector,
} from "./sourceControl.ts";

/**
 * A change request named the way a thread link names one: the host below which the repository
 * is addressed, the repository path as that host writes it, and the number.
 *
 * The two strings are what `pullRequestHostOf` and the project's `repositoryIdentity` produce
 * from a git remote: the full path below the host, folded the way the host folds it (see
 * `normalizeSourceControlRepository`).
 */
export interface ChangeRequestLink {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  /**
   * The web host and port a Forgejo change request was read from. Only Forgejo links carry it,
   * so its presence is also what says a link came from an instance whose port and mount path
   * tell instances apart; `repository` keeps the mount path's case for the same reason.
   */
  readonly authority?: string;
}

/** The host itself, one of its subdomains, or an install named after the provider. */
function isHostOf(hostname: string, apex: string, label?: string): boolean {
  if (hostname === apex || hostname.endsWith(`.${apex}`)) return true;
  return label !== undefined && hostname.split(".").includes(label);
}

/**
 * The repository and number behind a change request URL on a host this can read, or null for
 * anything else — an issue, a commit, a repository root, a host this cannot tell apart from an
 * ordinary link. A doubtful match is worse than no match, so nothing here guesses.
 *
 * Each host is recognised by the path shape it alone uses, guarded by a hostname it could
 * plausibly be served from, since self-hosted installs are named whatever their admin chose:
 * GitLab's `/-/` marker is unique enough to trust on any hostname, while `/pull/` is generic
 * enough that it is only believed from a GitHub-ish host.
 *
 * Nothing here tries to tell a lookalike hostname from a real one — `github.com.evil.test` and
 * the rest are an open set, and blocking spellings of it costs real hosts (`gitlab.com.br` is a
 * registrable domain). What a claim is worth is decided where it is used.
 */
export function parseChangeRequestUrl(targetUrl: string): ChangeRequestLink | null {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return null;
  }
  // `javascript:`, `mailto:` and friends have no host to speak of and nothing to open.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();

  // GitHub, and any Enterprise install: /{owner}/{repo}/pull/{n}
  if (isHostOf(host, "github.com", "github")) {
    const match = /^\/([^/]+\/[^/]+)\/pull\/(\d+)(?:\/|$)/u.exec(url.pathname);
    if (match) return claim(host, match);
  }
  // GitLab, self-hosted included: /{group}/[{subgroup}/...]{repo}/-/merge_requests/{n}. The `/-/`
  // separator is GitLab's own, so the hostname is not asked about.
  const gitlab = /^\/([^/]+(?:\/[^/]+)+)\/-\/merge_requests\/(\d+)(?:\/|$)/u.exec(url.pathname);
  if (gitlab) return claim(host, gitlab);
  // Forgejo uses /pulls/ on arbitrary instance hosts, optionally below a subpath.
  const forgejo = /^\/([^/]+(?:\/[^/]+)+)\/pulls\/(\d+)(?:\/|$)/u.exec(url.pathname);
  if (forgejo) {
    const link = claim(host, forgejo, "forgejo");
    return link === null ? null : { ...link, authority: url.host.toLowerCase() };
  }
  // Bitbucket Cloud: /{workspace}/{repo}/pull-requests/{n}
  if (isHostOf(host, "bitbucket.org", "bitbucket")) {
    const match = /^\/([^/]+\/[^/]+)\/pull-requests\/(\d+)(?:\/|$)/u.exec(url.pathname);
    return claim(host, match);
  }
  // Azure DevOps, both the current host and the per-organisation one it replaced. `_git` is part
  // of the repository path there, as it is in the remote URL the identity is read from.
  if (isHostOf(host, "dev.azure.com") || host.endsWith(".visualstudio.com")) {
    const match = /^\/((?:[^/]+\/)*_git\/[^/]+)\/pullrequest\/(\d+)(?:\/|$)/u.exec(url.pathname);
    return claim(host, match);
  }
  return null;
}

function claim(
  host: string,
  match: RegExpExecArray | null,
  kind?: string,
): ChangeRequestLink | null {
  const repository = match?.[1];
  const number = Number(match?.[2]);
  return repository && Number.isSafeInteger(number) && number > 0
    ? {
        host,
        repository:
          kind === "forgejo"
            ? normalizeSourceControlRepository(repository, kind)
            : repository.toLowerCase(),
        number,
      }
    : null;
}

/**
 * The web URL a host writes for a change request; null when its shape is unknown.
 *
 * A Forgejo instance's scheme is not part of its identity, so it is read from what the identity
 * knows about the instance: the resolved `webUrl` first, which an SSH checkout of an HTTP-only
 * instance has nothing else to offer, then an HTTP remote. Either is trusted only when it names
 * `host`; otherwise https is assumed.
 */
export function changeRequestUrlFor(
  kind: string | null | undefined,
  host: string,
  repository: string,
  number: number,
  remoteUrl?: string,
  webUrl?: string,
): string | null {
  switch (kind) {
    case "github":
      return `https://${host}/${repository}/pull/${number}`;
    case "forgejo": {
      const origin =
        [webUrl, remoteUrl]
          .map(httpUrl)
          .find(
            (url) =>
              url !== null &&
              (url.hostname.toLowerCase() === host.toLowerCase() ||
                url.host.toLowerCase() === host.toLowerCase()),
          )?.origin ?? `https://${host}`;
      return `${origin}/${repository}/pulls/${number}`;
    }
    case "gitlab":
      return `https://${host}/${repository}/-/merge_requests/${number}`;
    case "bitbucket":
      return `https://${host}/${repository}/pull-requests/${number}`;
    case "azure-devops":
      return `https://${canonicalRepositoryKey(`${host}/${repository}`.toLowerCase())}/pullrequest/${number}`;
    default:
      return null;
  }
}

/** Builds a GitHub URL that remains available when the pull request API cannot be read. */
export function gitHubPullRequestBrowserUrl(
  identity: RepositoryIdentity | null | undefined,
  repository: string,
  number: number,
): string | null {
  if (identity?.provider !== "github" || !Number.isSafeInteger(number) || number < 1) return null;
  const repositoryPath = repository.split("/");
  if (
    repositoryPath.length !== 2 ||
    repositoryPath.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    return null;
  }

  let origin: string | null = null;
  try {
    const remoteUrl = new URL(identity.locator.remoteUrl.trim());
    if (remoteUrl.protocol === "http:" || remoteUrl.protocol === "https:") {
      origin = remoteUrl.origin;
    }
  } catch {
    // SCP-style remotes are read from their normalized identity below.
  }
  const hostname = identity.canonicalKey.split("/")[0];
  if (origin === null && !hostname) return null;

  try {
    const url = new URL(origin ?? `https://${hostname}`);
    url.pathname = `/${repositoryPath.join("/")}/pull/${number}`;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The pull-request URL a GitHub-style `#123` autolink might name. GitHub writes every bare
 * reference through `/issues/`, including pull requests, so this only builds a candidate: the
 * caller must successfully read it as a pull request before treating it as one.
 */
export function pullRequestCandidateUrlFromReferenceAutolink(targetUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !(
      url.hostname.toLowerCase() === "github.com" ||
      url.hostname.toLowerCase().endsWith(".github.com") ||
      url.hostname.toLowerCase().split(".").includes("github")
    )
  ) {
    return null;
  }
  const match = /^\/([^/]+\/[^/]+)\/issues\/(\d+)(?:\/|$)/u.exec(url.pathname);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  url.pathname = `/${match[1]}/pull/${match[2]}`;
  return url.toString();
}

function httpUrl(value: string | null | undefined): URL | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const trimSlashes = (path: string) => path.replace(/^\/+|\/+$/g, "");

/**
 * Whether a link was read from the instance an identity's repository lives on: the same host,
 * and for Forgejo the same web port and mount path.
 *
 * A Forgejo link carries its web authority. An identity that knows its own — the resolved
 * `webUrl` first, else an HTTP remote — compares it, so two instances on one hostname stay
 * apart; the canonical key cannot say, since it drops the scheme and an SSH remote names a
 * clone host. One that only knows an SSH clone host compares hostnames: the port and mount are
 * the login's to resolve, and refusing every link would be worse than trusting the host. Links
 * from other providers carry no authority and their identities record no port, so hostnames
 * decide.
 */
export function changeRequestLinkOnRepositoryInstance(
  link: Pick<ChangeRequestLink, "host" | "repository" | "authority">,
  identity: RepositoryIdentity | null | undefined,
): boolean {
  if (!identity) return false;
  const kind = identity.provider as SourceControlProviderKind | undefined;
  if (kind !== "forgejo" || link.authority === undefined) {
    return pullRequestHostOf(identity, kind ?? "unknown") === link.host.toLowerCase();
  }
  const web = httpUrl(identity.webUrl);
  const known = web ?? httpUrl(identity.locator.remoteUrl);
  if (known === null) return pullRequestHostOf(identity, kind) === link.host.toLowerCase();
  if (known.host.toLowerCase() !== link.authority) return false;
  // The resolved web URL is the repository's own page, so everything above owner/name is the
  // instance's mount path, which the link's repository must sit below.
  if (web === null) return true;
  const mount = trimSlashes(web.pathname).split("/").slice(0, -2).join("/");
  return mount.length === 0 || `${link.repository}/`.startsWith(`${mount}/`);
}

/**
 * Whether a link names the repository behind an identity. The identity's repository is its
 * `webUrl` path for Forgejo — the mount path lives there and not in an SSH remote — and its
 * `displayName` otherwise; Azure compares canonical keys because its SSH and web spellings
 * share no path. Both sides fold the way the provider folds.
 */
export function changeRequestLinkMatchesRepository(
  link: Pick<ChangeRequestLink, "host" | "repository" | "authority">,
  identity: RepositoryIdentity | null | undefined,
): boolean {
  if (!identity) return false;
  const kind = identity.provider as SourceControlProviderKind | undefined;
  if (kind === "azure-devops") {
    return (
      canonicalRepositoryKey(identity.canonicalKey) ===
      canonicalRepositoryKey(`${link.host}/${link.repository}`)
    );
  }
  const web = kind === "forgejo" ? httpUrl(identity.webUrl) : null;
  const repository =
    web === null ? sourceControlRepositorySelector(identity) : trimSlashes(web.pathname);
  return (
    !!repository &&
    changeRequestLinkOnRepositoryInstance(link, identity) &&
    normalizeSourceControlRepository(repository, kind) ===
      normalizeSourceControlRepository(link.repository, kind)
  );
}

/** Match a stored PR without requiring its project to remain available. */
export function matchesLinkedPullRequestUrl(
  linkedPullRequest: ThreadLinkedPullRequest,
  targetUrl: string,
): boolean {
  const linked = parseChangeRequestUrl(linkedPullRequest.url);
  const target = parseChangeRequestUrl(targetUrl);
  return (
    linked !== null &&
    target !== null &&
    linked.host === target.host &&
    linked.repository === target.repository &&
    linked.number === target.number &&
    linked.authority === target.authority
  );
}

/** The repository root behind a recognised change-request URL, without PR-specific state. */
export function changeRequestRepositoryUrl(targetUrl: string): string | null {
  const changeRequest = parseChangeRequestUrl(targetUrl);
  if (changeRequest === null) return null;
  const url = new URL(targetUrl);
  const repositoryPath =
    /^(.*?)\/-\/merge_requests\/\d+(?:\/|$)/iu.exec(url.pathname)?.[1] ??
    /^(.*)\/pulls\/\d+(?:\/|$)/iu.exec(url.pathname)?.[1] ??
    /^(.*?)(?:\/pulls?\/\d+|\/-\/merge_requests\/\d+|\/pull-requests\/\d+|\/pullrequest\/\d+)(?:\/|$)/iu.exec(
      url.pathname,
    )?.[1];
  if (!repositoryPath) return null;
  url.pathname = repositoryPath;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function siblingPullRequestUrl(url: string, number: number): string | null {
  const reference = parseChangeRequestUrl(url);
  if (reference === null || !Number.isSafeInteger(number) || number < 1) return null;
  const sibling = new URL(url);
  const route = /^\/(-\/merge_requests|pulls?|pull-requests|pullrequest)\/\d+(?:\/|$)/u.exec(
    sibling.pathname.slice(reference.repository.length + 1),
  )?.[1];
  if (route === undefined) return null;
  sibling.pathname = `/${reference.repository}/${route}/${number}`;
  sibling.search = "";
  sibling.hash = "";
  return sibling.toString();
}
