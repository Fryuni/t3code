import type { RepositoryIdentity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { forgejoRepositoryIdentity } from "./forgejoRepositoryIdentity.ts";

function identity(remoteUrl: string): RepositoryIdentity {
  return {
    canonicalKey: "ssh.example.test/owner/repo",
    provider: "unknown",
    displayName: "Owner/Repo",
    rootPath: "/tmp/repo",
    locator: { source: "git-remote", remoteName: "origin", remoteUrl },
  };
}

describe("forgejoRepositoryIdentity", () => {
  it("re-roots an SSH remote on the instance's web scheme, port, and mount path", () => {
    // The SSH host and port belong to a separate clone daemon; only the login knows the web side.
    const refined = forgejoRepositoryIdentity(
      identity("ssh://git@ssh.example.test:2222/Owner/Repo.git"),
      "http://forge.example.test:3000/Forge/",
    );
    expect(refined).toMatchObject({
      provider: "forgejo",
      canonicalKey: "forge.example.test:3000/Forge/owner/repo",
      displayName: "Forge/Owner/Repo",
      webUrl: "http://forge.example.test:3000/Forge/Owner/Repo",
    });
    // The remote itself is untouched: it is still what git talks to.
    expect(refined?.locator.remoteUrl).toBe("ssh://git@ssh.example.test:2222/Owner/Repo.git");
  });

  it("does not repeat a mount path an HTTP remote already spells", () => {
    expect(
      forgejoRepositoryIdentity(
        identity("https://forge.example.test/Forge/Owner/Repo.git"),
        "https://forge.example.test/Forge",
      ),
    ).toMatchObject({
      canonicalKey: "forge.example.test/Forge/owner/repo",
      displayName: "Forge/Owner/Repo",
      webUrl: "https://forge.example.test/Forge/Owner/Repo",
    });
  });

  it("keeps case-distinct mount paths as distinct identities", () => {
    const keys = ["Forge", "forge"].map(
      (mount) =>
        forgejoRepositoryIdentity(
          identity("git@ssh.example.test:Owner/Repo.git"),
          `https://forge.example.test/${mount}`,
        )?.canonicalKey,
    );
    expect(keys).toEqual([
      "forge.example.test/Forge/owner/repo",
      "forge.example.test/forge/owner/repo",
    ]);
  });

  it("drops a default port, and answers null when the remote or base URL cannot be read", () => {
    expect(
      forgejoRepositoryIdentity(
        identity("git@codeberg.org:Owner/Repo.git"),
        "https://codeberg.org:443",
      ),
    ).toMatchObject({
      canonicalKey: "codeberg.org/owner/repo",
      webUrl: "https://codeberg.org/Owner/Repo",
    });
    expect(forgejoRepositoryIdentity(identity("   "), "https://codeberg.org")).toBeNull();
    expect(
      forgejoRepositoryIdentity(identity("git@codeberg.org:Owner/Repo.git"), "not a url"),
    ).toBeNull();
  });
});
