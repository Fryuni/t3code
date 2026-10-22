import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { cliArchiveTarCommand, newestCliReleaseVersion, parseChecksums } from "./cliRelease.ts";

describe("cliRelease", () => {
  describe("release repository baked in at build time", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    // Packaged builds always define it: empty unless a fork's workflow set it.
    it.each([
      { build: "without the define", define: undefined, fork: undefined },
      { build: "with an empty define", define: "", fork: undefined },
      { build: "with a blank define", define: "  ", fork: undefined },
      { build: "with a fork's define", define: " someone/t3code ", fork: "someone/t3code" },
    ])(
      "a build $build releases from the fork it names, else upstream",
      async ({ define, fork }) => {
        vi.stubGlobal("__T3CODE_BUILD_RELEASE_REPOSITORY__", define);
        vi.resetModules();
        const release = await import("./cliRelease.ts");
        const repository = fork ?? "pingdotgg/t3code";
        expect(release.CLI_RELEASE_FORK_REPOSITORY).toBe(fork);
        expect(release.CLI_RELEASE_LATEST_URL).toBe(
          fork === undefined ? undefined : `https://api.github.com/repos/${fork}/releases/latest`,
        );
        expect(release.CLI_RELEASES_PAGE_URL).toBe(`https://github.com/${repository}/releases`);
        expect(release.cliReleaseIndexPageUrl(1)).toBe(
          `https://api.github.com/repos/${repository}/releases?per_page=100&page=1`,
        );
        expect(release.cliReleaseDownloadBaseUrl("1.0.0")).toBe(
          `https://github.com/${repository}/releases/download/v1.0.0`,
        );
      },
    );
  });

  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  t3-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *t3-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("t3-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("t3-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("picks the newest non-draft release on the requested channel", () => {
    const releases = [
      { tag_name: "v1.2.4-preview.20260912.9", draft: true },
      { tag_name: "v1.2.4-preview.20260912.8" },
      { tag_name: "v1.2.4-nightly.20260912.7" },
      { tag_name: "desktop-preview" },
      { tag_name: "v1.2.3" },
      { tag_name: "v1.2.3-nightly.20260911.2" },
    ];
    expect(newestCliReleaseVersion(releases, "preview")).toBe("1.2.4-preview.20260912.8");
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("1.2.4-nightly.20260912.7");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.2.3");
    expect(newestCliReleaseVersion([{ tag_name: "v1.2.3" }], "preview")).toBeUndefined();
  });
});
