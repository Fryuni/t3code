declare const __T3CODE_BUILD_RELEASE_REPOSITORY__: string | undefined;

/**
 * A fork's release workflow bakes its `owner/repo` into the server bundle, which then downloads
 * and updates from the fork's releases and advertises it as `releaseRepository`. Builds from
 * source and every other bundle leave it unset and follow upstream.
 */
export const CLI_RELEASE_FORK_REPOSITORY =
  typeof __T3CODE_BUILD_RELEASE_REPOSITORY__ === "undefined"
    ? undefined
    : __T3CODE_BUILD_RELEASE_REPOSITORY__.trim() || undefined;
const CLI_RELEASE_REPOSITORY = CLI_RELEASE_FORK_REPOSITORY ?? "pingdotgg/t3code";

/** The public releases page, which clients read without the anonymous API quota. */
export function cliReleasesPageUrl(repository: string): string {
  return `https://github.com/${repository}/releases`;
}
export const CLI_RELEASES_PAGE_URL = cliReleasesPageUrl(CLI_RELEASE_REPOSITORY);

/**
 * GitHub's latest release for a repository, which excludes drafts and
 * prereleases. It is the whole update policy of a fork: forks publish no
 * channel trains to walk.
 */
function cliReleaseLatestUrl(repository: string): string {
  return `https://api.github.com/repos/${repository}/releases/latest`;
}

/** Set only in fork builds. */
export const CLI_RELEASE_LATEST_URL =
  CLI_RELEASE_FORK_REPOSITORY === undefined
    ? undefined
    : cliReleaseLatestUrl(CLI_RELEASE_FORK_REPOSITORY);

export const CLI_RELEASE_CHECKSUMS_FILE = "SHA256SUMS";
export const CLI_RELEASE_BASE_URL_ENV = "T3CODE_RELEASE_BASE_URL";

// Keep archive keys aligned with the Linux matrix, Windows ARM64 build, and cli_archive rows in release.yml.
// Node single-executables do not support darwin-x64 and segfault at startup.
const CLI_ARCHIVE_PLATFORM_KEYS = [
  "darwin-arm64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
] as const;
export type CliArchivePlatformKey = (typeof CLI_ARCHIVE_PLATFORM_KEYS)[number];

export function cliArchivePlatformKey(
  platform: NodeJS.Platform,
  arch: string,
): CliArchivePlatformKey | undefined {
  const key = `${platform}-${arch}`;
  return CLI_ARCHIVE_PLATFORM_KEYS.find((candidate) => candidate === key);
}

/** Use System32 bsdtar on Windows; Git-for-Windows GNU tar cannot open zip archives. */
export function cliArchiveTarCommand(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (platform !== "win32") return "tar";
  const systemRoot = env["SystemRoot"] ?? env["windir"] ?? "C:\\Windows";
  return `${systemRoot}\\System32\\tar.exe`;
}

export function cliArchiveFileName(version: string, platformKey: CliArchivePlatformKey): string {
  return `t3-${version}-${platformKey}.${platformKey.startsWith("win32") ? "zip" : "tar.gz"}`;
}

const CLI_RELEASE_DEFAULT_BASE_URL = `https://github.com/${CLI_RELEASE_REPOSITORY}/releases/download`;

/**
 * The shell command that installs exactly `version`. A fork's versions exist only on its own
 * releases, which upstream's installer cannot reach without being pointed there.
 */
export function cliInstallCommand(version: string): string {
  return CLI_RELEASE_FORK_REPOSITORY === undefined
    ? `curl -fsSL https://t3.codes/install.sh | T3CODE_VERSION=${version} sh`
    : `curl -fsSL https://raw.githubusercontent.com/${CLI_RELEASE_FORK_REPOSITORY}/main/scripts/install.sh | T3CODE_VERSION=${version} ${CLI_RELEASE_BASE_URL_ENV}=${CLI_RELEASE_DEFAULT_BASE_URL} sh`;
}

export function cliReleaseDownloadBaseUrl(
  version: string,
  baseUrl: string | undefined = CLI_RELEASE_DEFAULT_BASE_URL,
): string {
  return `${(baseUrl?.trim() || CLI_RELEASE_DEFAULT_BASE_URL).replace(/\/+$/, "")}/v${version}`;
}

export function parseChecksums(text: string): ReadonlyMap<string, string> {
  const checksums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S.*)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      checksums.set(match[2], match[1].toLowerCase());
    }
  }
  return checksums;
}

export type CliReleaseChannel = "stable" | "nightly" | "preview";
export const CLI_RELEASE_CHANNELS: ReadonlyArray<CliReleaseChannel> = [
  "stable",
  "nightly",
  "preview",
];

export function cliReleaseChannelOf(version: string): CliReleaseChannel {
  const channel = /^[^-+]+-(nightly|preview)\.\d{8}\.\d+$/.exec(version)?.[1];
  return channel === "nightly" || channel === "preview" ? channel : "stable";
}

/** Page until the channel matches; nightlies can push preview/stable releases past the first page. */
export function cliReleaseIndexPageUrl(page: number): string {
  return `https://api.github.com/repos/${CLI_RELEASE_REPOSITORY}/releases?per_page=100&page=${page}`;
}

/** The version a release tag (`v<version>`) publishes, if it names one. */
export function cliReleaseTagVersion(tagName: string): string | undefined {
  return /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tagName)?.[1];
}

/** Draft assets are not downloadable. */
export function newestCliReleaseVersion(
  releases: ReadonlyArray<{
    readonly tag_name: string;
    readonly draft?: boolean | undefined;
  }>,
  channel: CliReleaseChannel,
): string | undefined {
  for (const release of releases) {
    if (release.draft) continue;
    const version = cliReleaseTagVersion(release.tag_name);
    if (version === undefined) continue;
    if (cliReleaseChannelOf(version) === channel) return version;
  }
  return undefined;
}
