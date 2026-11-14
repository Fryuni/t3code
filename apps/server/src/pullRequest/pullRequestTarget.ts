import type { OrchestrationProjectShell, SourceControlProviderKind } from "@t3tools/contracts";
import { isSshRemoteUrl, normalizeSourceControlRepository } from "@t3tools/shared/sourceControl";
import { repositoryPathFromRemoteUrl } from "@t3tools/source-control-core/server/SourceControlProvider";
import type { ChangeRequestLink } from "@t3tools/source-control-core/shared/definition";
import { canonicalizeGitCafePullRequestUrl } from "@t3tools/source-control-definitions/registry";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";
import { normalizeThreadPullRequestKey } from "../sourceControl/threadPullRequests.ts";

export interface PullRequestTarget {
  readonly url?: string | undefined;
  readonly repository?: string | undefined;
  readonly number?: number | undefined;
  readonly host?: string | undefined;
}

export class PullRequestUrlInvalidError extends Schema.TaggedError<PullRequestUrlInvalidError>()(
  "PullRequestUrlInvalidError",
  {},
) {
  override get message(): string {
    return "This is not a recognised pull request URL. Pass repository and number instead.";
  }
}

export class PullRequestTargetIncompleteError extends Schema.TaggedError<PullRequestTargetIncompleteError>()(
  "PullRequestTargetIncompleteError",
  {},
) {
  override get message(): string {
    return "Pass either url, or both repository and number.";
  }
}

export class PullRequestHostRequiredError extends Schema.TaggedError<PullRequestHostRequiredError>()(
  "PullRequestHostRequiredError",
  {},
) {
  override get message(): string {
    return "This thread's project has no recognised remote. Pass host or url.";
  }
}

export class PullRequestUrlUnavailableError extends Schema.TaggedError<PullRequestUrlUnavailableError>()(
  "PullRequestUrlUnavailableError",
  {},
) {
  override get message(): string {
    return "This thread's project is on a host with no known pull request URL shape. Pass url.";
  }
}

export type PullRequestTargetError =
  | PullRequestUrlInvalidError
  | PullRequestTargetIncompleteError
  | PullRequestHostRequiredError
  | PullRequestUrlUnavailableError;

export interface ResolvedTarget {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly url: string;
}

function projectHostAndProvider(project: OrchestrationProjectShell | undefined): {
  readonly host: string | null;
  readonly kind: SourceControlProviderKind | null;
} {
  const identity = project?.repositoryIdentity;
  const kind = identity?.provider ?? null;
  if (!identity || kind === null) return { host: null, kind: null };
  return {
    host: sourceControlDefinitions.changeRequestHost(identity, kind),
    kind,
  };
}

/**
 * The project's repository when a link names it on its SSH clone host instead of its web host.
 * The clone host is what an agent reads from `git remote`, and a URL built from it can differ
 * from the web host (a private-network alias, an `insteadOf` rewrite) and resolve to nothing.
 */
function projectRepositoryOnCloneHost(
  link: Pick<ChangeRequestLink, "host" | "repository" | "authority">,
  project: OrchestrationProjectShell | undefined,
): string | null {
  const identity = project?.repositoryIdentity;
  const { host, kind } = projectHostAndProvider(project);
  if (!identity || host === null || !isSshRemoteUrl(identity.locator.remoteUrl)) return null;
  const cloneBaseUrl = sourceControlDefinitions.recognizeRemote(
    identity.locator.remoteUrl,
  )?.baseUrl;
  const clonePath = repositoryPathFromRemoteUrl(identity.locator.remoteUrl);
  if (
    cloneBaseUrl === undefined ||
    clonePath === null ||
    URL.parse(cloneBaseUrl)?.hostname !== link.host ||
    // Only a known web URL says which port the web host is on; without one, `host` is the
    // canonical hostname and only hostnames compare.
    (identity.webUrl !== undefined && /^https?:\/\//iu.test(identity.webUrl)
      ? (link.authority ?? link.host) === host
      : URL.parse(`https://${host}`)?.hostname === link.host) ||
    normalizeSourceControlRepository(clonePath, kind) !==
      normalizeSourceControlRepository(link.repository, kind)
  )
    return null;
  return sourceControlDefinitions.repositorySelector(identity);
}

export const resolveTarget = Effect.fn("PullRequestsToolkit.resolveTarget")(function* (
  input: PullRequestTarget,
  project: OrchestrationProjectShell | undefined,
) {
  let reference: Pick<PullRequestTarget, "host" | "repository" | "number"> = input;
  if (input.url !== undefined) {
    const parsed = sourceControlDefinitions.parseChangeRequestUrl(input.url)?.link;
    if (parsed === undefined) {
      return yield* new PullRequestUrlInvalidError({});
    }
    const repository = projectRepositoryOnCloneHost(parsed, project);
    if (repository === null) {
      return {
        ...normalizeThreadPullRequestKey(parsed),
        url: canonicalizeGitCafePullRequestUrl(input.url),
      } satisfies ResolvedTarget;
    }
    reference = { repository, number: parsed.number };
  }
  const { number } = reference;
  if (reference.repository === undefined || number === undefined) {
    return yield* new PullRequestTargetIncompleteError({});
  }
  const projectHost = projectHostAndProvider(project);
  const host = (reference.host ?? projectHost.host)?.toLowerCase();
  if (host === undefined) {
    return yield* new PullRequestHostRequiredError({});
  }
  const repository = normalizeSourceControlRepository(
    reference.repository,
    host === projectHost.host ? projectHost.kind : undefined,
  );
  // Without a URL, a public forge host says what shape its change request URLs take;
  // any other host is taken to run the project's own forge.
  const recognizedKind = sourceControlDefinitions.recognizeRemote(`https://${host}`)?.kind;
  const kind =
    sourceControlDefinitions.findByPublicHost(host)?.kind ??
    (recognizedKind === "gitcafe" ? recognizedKind : projectHost.kind);
  const identity = project?.repositoryIdentity;
  const url =
    kind === null
      ? null
      : sourceControlDefinitions.get(kind).changeRequestUrl({
          host,
          repository,
          number,
          // Only the web URL's origin applies, as `repository` need not be the project's; it
          // knows the scheme an SSH remote cannot say.
          remoteUrl: identity?.webUrl ?? identity?.locator.remoteUrl,
        });
  if (url === null) {
    return yield* new PullRequestUrlUnavailableError({});
  }
  return {
    ...normalizeThreadPullRequestKey({ host, repository, number, url }),
    url: canonicalizeGitCafePullRequestUrl(url),
  } satisfies ResolvedTarget;
});
