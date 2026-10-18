import type { EnvironmentConnectionPhase } from "../connection/presentation.ts";
import type {
  CommandId,
  EnvironmentId,
  ProjectMutation,
  ProjectId,
  RepositoryIdentity,
  ServerConfig,
  SourceControlDiscoveryResult,
  SourceControlRepositoryInfo,
} from "@t3tools/contracts";
import { SourceControlProviderKind } from "@t3tools/contracts";
import { withoutRemoteCredentials } from "@t3tools/shared/git";
import { newProjectFolderName, normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";

import {
  appendBrowsePathSegment,
  ensureBrowseDirectoryPath,
  findProjectByPath,
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "../state/projects.ts";
import type { EnvironmentProject } from "../state/models.ts";
import { sourceControlClients } from "../sourceControlClients.ts";
import type { SourceControlClientDefinition } from "../sourceControlClients.ts";

export type AddProjectRemoteSource = SourceControlProviderKind | "url";

export function canCreateProjectInEnvironment(
  connectionPhase: EnvironmentConnectionPhase | null | undefined,
): boolean {
  return connectionPhase === "connected";
}

export function availableScratchWorkspaceRoot(
  connectionPhase: EnvironmentConnectionPhase | null | undefined,
  serverConfig: Pick<ServerConfig, "scratchWorkspaceRoot"> | null | undefined,
): string | null {
  return canCreateProjectInEnvironment(connectionPhase)
    ? (serverConfig?.scratchWorkspaceRoot ?? null)
    : null;
}

export interface AddProjectRemoteSourceReadinessEntry {
  readonly ready: boolean;
  readonly hint: string | null;
}

export type AddProjectRemoteSourceReadiness = (
  source: AddProjectRemoteSource,
) => AddProjectRemoteSourceReadinessEntry;

export type AddProjectCloneFlow =
  | {
      readonly step: "repository";
      readonly environmentId: EnvironmentId;
      readonly source: AddProjectRemoteSource;
    }
  | {
      readonly step: "confirm";
      readonly environmentId: EnvironmentId;
      readonly source: AddProjectRemoteSource;
      readonly repositoryInput: string;
      readonly repository: SourceControlRepositoryInfo | null;
      readonly remoteUrl: string;
    };

const ADD_PROJECT_REMOTE_PROVIDER_SOURCES: ReadonlyArray<SourceControlProviderKind> =
  sourceControlClients.definitions.map((definition) => definition.kind);

export function addProjectRemoteSourceLabel(source: AddProjectRemoteSource): string {
  return source === "url" ? "Git URL" : sourceControlClients.get(source).pickerLabel;
}

export function addProjectRemoteSourcePathHint(source: AddProjectRemoteSource): string {
  return source === "url" ? "URL" : sourceControlClients.get(source).repositoryPathHint;
}

export function addProjectRemoteSourceProvider(
  source: AddProjectRemoteSource,
): SourceControlProviderKind | null {
  return source === "url" ? null : source;
}

export function parseAddProjectRemoteSource(
  value: string | null | undefined,
): AddProjectRemoteSource {
  return (value ? sourceControlClients.find(value)?.kind : undefined) ?? "url";
}

const GITHUB_REPOSITORY_SHORTHAND =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]+(?:\.git)?$/;

export function normalizePastedCloneUrl(input: string): string {
  const trimmed = input.trim();
  if (!GITHUB_REPOSITORY_SHORTHAND.test(trimmed)) return trimmed;
  const repository = trimmed.endsWith(".git") ? trimmed : `${trimmed}.git`;
  return `https://github.com/${repository}`;
}

export function getDefaultCloneUrl(
  repository: Pick<SourceControlRepositoryInfo, "provider" | "url" | "sshUrl">,
): string {
  return sourceControlClients.get(repository.provider).defaultCloneTransport === "https"
    ? repository.url
    : repository.sshUrl;
}

export function sortAddProjectProviderSources(
  readiness: AddProjectRemoteSourceReadiness,
): ReadonlyArray<SourceControlProviderKind> {
  return Arr.sort(
    ADD_PROJECT_REMOTE_PROVIDER_SOURCES,
    Order.mapInput(
      Order.Struct({
        ready: Order.flip(Order.Boolean),
        label: Order.String,
      }),
      (source: SourceControlProviderKind) => ({
        ready: readiness(source).ready,
        label: addProjectRemoteSourceLabel(source),
      }),
    ),
  );
}

const READY: AddProjectRemoteSourceReadinessEntry = { ready: true, hint: null };
const UNAVAILABLE: AddProjectRemoteSourceReadinessEntry = {
  ready: false,
  hint: "Provider status unavailable. Open Source Control settings and rescan.",
};

export function buildAddProjectRemoteSourceReadiness(
  discovery: SourceControlDiscoveryResult | null,
): AddProjectRemoteSourceReadiness {
  const providerByKind = new Map(
    (discovery?.sourceControlProviders ?? []).map((provider) => [provider.kind, provider]),
  );
  return (source) => {
    if (source === "url") return READY;
    const provider = providerByKind.get(source);
    if (!provider) return UNAVAILABLE;
    if (provider.status !== "available") return { ready: false, hint: provider.installHint };
    if (provider.auth.status === "unauthenticated") {
      return {
        ready: false,
        hint:
          Option.getOrNull(provider.auth.detail) ??
          `${provider.label} is not authenticated. Open Source Control settings for setup guidance.`,
      };
    }
    return READY;
  };
}

export function getAddProjectInitialQuery(baseDirectory: string | null | undefined): string {
  const trimmed = baseDirectory?.trim() ?? "";
  return trimmed.length === 0 ? "~/" : ensureBrowseDirectoryPath(trimmed);
}

export function getCloneDirectoryName(repositoryOrRemoteUrl: string | null | undefined): string {
  const withoutQuery = (repositoryOrRemoteUrl ?? "").split(/[?#]/)[0]?.trim() ?? "";
  const schemeIndex = withoutQuery.indexOf("://");
  const hasHost = schemeIndex >= 0 || /^[^/\\:]+@[^/\\:]+:/.test(withoutQuery);
  const pathPart = schemeIndex >= 0 ? withoutQuery.slice(schemeIndex + "://".length) : withoutQuery;
  const segments = pathPart.split(/[/\\:]+/).filter((segment) => segment.trim().length > 0);
  if (hasHost && segments.length < 2) {
    return "";
  }

  const lastSegment = segments.at(-1)?.trim() ?? "";
  if (hasHost && segments.length === 2 && /^\d+$/.test(lastSegment)) {
    return "";
  }
  return lastSegment.endsWith(".git") ? lastSegment.slice(0, -".git".length) : lastSegment;
}

export function getCloneDestinationPath(
  directoryPath: string,
  directoryName: string | null | undefined,
): string {
  const name = directoryName?.trim() ?? "";
  if (name.length === 0) {
    return directoryPath;
  }
  return `${ensureBrowseDirectoryPath(directoryPath)}${name}`;
}

export function getNewProjectPathPreview(newProjectsRoot: string, name: string): string {
  return getCloneDestinationPath(newProjectsRoot, newProjectFolderName(name));
}

export interface NewProjectPublishTarget {
  readonly definition: SourceControlClientDefinition;
  readonly owner: string | null;
}

export function getNewProjectPublishTargets(
  discovery: SourceControlDiscoveryResult | null,
): ReadonlyArray<NewProjectPublishTarget> {
  const readiness = buildAddProjectRemoteSourceReadiness(discovery);
  return sourceControlClients.definitions.flatMap((definition) => {
    if (!readiness(definition.kind).ready) return [];
    const provider = discovery?.sourceControlProviders.find(
      (candidate) => candidate.kind === definition.kind,
    );
    const placement = definition.newRepositoryOwner(
      provider ? Option.getOrNull(provider.auth.account) : null,
    );
    return placement === null ? [] : [{ definition, owner: placement.owner }];
  });
}

export function getNewProjectPublishTarget(
  targets: ReadonlyArray<NewProjectPublishTarget>,
  kind: SourceControlProviderKind | null,
): NewProjectPublishTarget | null {
  return targets.find((target) => target.definition.kind === kind) ?? targets[0] ?? null;
}

export function getNewProjectRepository(
  target: Pick<NewProjectPublishTarget, "owner">,
  workspaceRoot: string,
): string {
  const folderName = workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  return target.owner ? `${target.owner}/${folderName}` : folderName;
}

export function getCloneDestinationBrowsePath(input: {
  readonly browseDirectoryPath: string;
  readonly selectedDirectoryName: string;
  readonly cloneDirectoryName: string;
  readonly caseSensitive: boolean;
}): string {
  const selectedDirectoryPath = appendBrowsePathSegment(
    input.browseDirectoryPath,
    input.selectedDirectoryName,
  );
  const selectedDirectoryMatches = input.caseSensitive
    ? input.selectedDirectoryName === input.cloneDirectoryName
    : input.selectedDirectoryName.toLowerCase() === input.cloneDirectoryName.toLowerCase();
  return selectedDirectoryMatches
    ? selectedDirectoryPath
    : getCloneDestinationPath(selectedDirectoryPath, input.cloneDirectoryName);
}

export function resolveAddProjectPath(input: {
  readonly rawPath: string;
  readonly currentProjectCwd?: string | null;
  readonly platform: string;
}): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string } {
  const rawPath = input.rawPath.trim();
  if (rawPath.length === 0) {
    return { ok: false, error: "Enter a project path." };
  }
  if (isUnsupportedWindowsProjectPath(rawPath, input.platform)) {
    return { ok: false, error: "Windows-style paths are only supported on Windows environments." };
  }
  if (isExplicitRelativeProjectPath(rawPath) && !input.currentProjectCwd) {
    return { ok: false, error: "Relative paths require an active project in this environment." };
  }
  const path = resolveProjectPathForDispatch(rawPath, input.currentProjectCwd);
  return path.length === 0 ? { ok: false, error: "Enter a project path." } : { ok: true, path };
}

export function findExistingAddProject(input: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly environmentId: EnvironmentId;
  readonly path: string;
}): EnvironmentProject | null {
  return (
    findProjectByPath(
      input.projects.filter((project) => project.environmentId === input.environmentId),
      input.path,
    ) ?? null
  );
}

export function buildProjectCreateCommand(input: {
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
}): Extract<ProjectMutation, { type: "project.create" }> {
  return {
    type: "project.create",
    commandId: input.commandId,
    projectId: input.projectId,
    title: inferProjectTitleFromPath(input.workspaceRoot),
    workspaceRoot: input.workspaceRoot,
    createWorkspaceRootIfMissing: true,
    defaultModelSelection: null,
  };
}

/**
 * Checkouts are listed whenever a second machine could hold one. Machines that
 * are connected but lack a checkout of the project can receive a new one.
 * Scratch and separately grouped projects never gain another checkout, since a
 * copy elsewhere would be a project of its own.
 */
export function projectCheckoutOptions<
  TEnvironment extends { readonly environmentId: string },
>(input: {
  readonly connectedEnvironments: ReadonlyArray<TEnvironment>;
  readonly checkoutEnvironmentIds: ReadonlyArray<string>;
  readonly checkoutCount: number;
  readonly canCheckOut: boolean;
}): { readonly visible: boolean; readonly targets: ReadonlyArray<TEnvironment> } {
  const checkedOut = new Set(input.checkoutEnvironmentIds);
  return {
    visible:
      input.checkoutCount > 1 || (input.canCheckOut && input.connectedEnvironments.length > 1),
    targets: input.canCheckOut
      ? input.connectedEnvironments.filter(
          (environment) => !checkedOut.has(environment.environmentId),
        )
      : [],
  };
}

// git's own rule: a URL scheme, or scp-like `host:path` with no slash before the
// colon. Anything else is a path that names a different place on another machine.
function isNetworkRemote(remoteUrl: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(remoteUrl)?.[1];
  if (scheme) return scheme.toLowerCase() !== "file";
  const colon = remoteUrl.indexOf(":");
  // A colon at index 1 is a Windows drive letter.
  return colon > 1 && !remoteUrl.slice(0, colon).includes("/");
}

/**
 * The remote whose clone becomes another checkout of this project, or null when
 * cloning would register a different project and the user should pick a folder.
 */
export function projectCheckoutCloneUrl(project: {
  readonly workspaceRoot: string;
  readonly repositoryIdentity?: RepositoryIdentity | null | undefined;
}): string | null {
  const identity = project.repositoryIdentity;
  if (!identity) return null;
  // A clone is registered at the repository root, not at this project's subdirectory.
  if (
    identity.rootPath === undefined ||
    normalizeProjectPathForComparison(identity.rootPath) !==
      normalizeProjectPathForComparison(project.workspaceRoot)
  ) {
    return null;
  }
  // Grouping follows a fork's origin, while the locator prefers its upstream.
  const remoteUrl = identity.origin ? identity.origin.remoteUrl : identity.locator.remoteUrl;
  // The locator is the checkout's raw remote; its token must not follow it elsewhere.
  return remoteUrl && isNetworkRemote(remoteUrl) ? withoutRemoteCredentials(remoteUrl) : null;
}
