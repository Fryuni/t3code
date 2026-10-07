import {
  AuthEnvironmentMaintainScope,
  sessionGrantsScope,
  type AuthSessionState,
  type ExecutionEnvironmentCapabilities,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  cliReleaseChannelOf,
  cliReleaseIndexPageUrl,
  cliReleaseLatestUrl,
  cliReleaseTagVersion,
  newestCliReleaseVersion,
} from "@t3tools/shared/cliRelease";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Schema from "effect/Schema";

export function canMaintainEnvironment(session: AuthSessionState | null, connected: boolean) {
  return (
    connected &&
    session?.authenticated === true &&
    sessionGrantsScope(session, AuthEnvironmentMaintainScope)
  );
}

export function supportsEnvironmentUpdate(
  capabilities: Pick<ExecutionEnvironmentCapabilities, "serverSelfUpdate" | "desktopAppUpdate">,
) {
  return (
    capabilities.serverSelfUpdate !== undefined &&
    (capabilities.serverSelfUpdate !== "desktop-managed" || capabilities.desktopAppUpdate === true)
  );
}

export function canUpdateEnvironmentProvider(provider: ServerProvider) {
  const compatibility = provider.compatibilityAdvisory?.latestVersionStatus;
  return (
    provider.installed &&
    provider.availability !== "unavailable" &&
    provider.versionAdvisory?.status === "behind_latest" &&
    provider.versionAdvisory.canUpdate &&
    provider.versionAdvisory.latestVersion !== null &&
    compatibility !== "broken" &&
    compatibility !== "unsupported" &&
    provider.updateState?.status !== "running" &&
    provider.updateState?.status !== "queued"
  );
}

const Releases = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.optionalKey(Schema.Boolean),
  }),
);
const decodeReleases = Schema.decodeUnknownSync(Releases);
const decodeLatestRelease = Schema.decodeUnknownSync(Schema.Struct({ tag_name: Schema.String }));

/**
 * Preserve the host's release channel and never offer a downgrade. A fork
 * build names its `releaseRepository`, whose latest release is the only target.
 */
export async function findEnvironmentUpdate(
  currentVersion: string,
  signal: AbortSignal,
  releaseRepository?: string,
) {
  if (releaseRepository !== undefined) {
    const response = await fetch(cliReleaseLatestUrl(releaseRepository), { signal });
    if (!response.ok) throw new Error(`Could not check releases (${response.status}). Try again.`);
    const { tag_name } = decodeLatestRelease(await response.json());
    const version = cliReleaseTagVersion(tag_name);
    if (version === undefined) throw new Error(`The latest release '${tag_name}' is not T3 Code.`);
    return compareSemverVersions(version, currentVersion) > 0 ? version : null;
  }
  const channel = cliReleaseChannelOf(currentVersion);
  for (let page = 1; ; page++) {
    const response = await fetch(cliReleaseIndexPageUrl(page), { signal });
    if (!response.ok) throw new Error(`Could not check releases (${response.status}). Try again.`);
    const releases = decodeReleases(await response.json());
    const version = newestCliReleaseVersion(releases, channel);
    if (version !== undefined) {
      return compareSemverVersions(version, currentVersion) > 0 ? version : null;
    }
    if (releases.length < 100) throw new Error(`No ${channel} release was found.`);
  }
}
