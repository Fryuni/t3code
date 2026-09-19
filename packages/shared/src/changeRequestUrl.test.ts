import { describe, expect, it } from "vite-plus/test";
import { ProjectId } from "@t3tools/contracts";

import {
  changeRequestLinkMatchesRepository,
  changeRequestLinkOnRepositoryInstance,
  changeRequestUrlFor,
  changeRequestRepositoryUrl,
  matchesLinkedPullRequestUrl,
  parseChangeRequestUrl,
  pullRequestCandidateUrlFromReferenceAutolink,
  siblingPullRequestUrl,
} from "./changeRequestUrl.ts";

describe("parseChangeRequestUrl", () => {
  it.each([
    ["https://codeberg.org/Owner/Repo/pulls/42", "codeberg.org", "owner/repo"],
    ["https://git.example.test/Forge/Owner/Repo/pulls/42", "git.example.test", "Forge/owner/repo"],
    ["https://git.fryuni.dev/Owner/Repo/pulls/42/files?w=1", "git.fryuni.dev", "owner/repo"],
    [
      "http://forge.example.test:3000/forge/Owner/Repo/pulls/42",
      "forge.example.test:3000",
      "forge/owner/repo",
    ],
    [
      "https://github.example.test:8443/Owner/Repo/pulls/42",
      "github.example.test:8443",
      "owner/repo",
    ],
  ])("reads the Forgejo instance and repository from %s", (url, host, repository) => {
    expect(parseChangeRequestUrl(url)).toEqual({
      host: new URL(url).hostname,
      authority: host,
      repository,
      number: 42,
    });
  });

  it("reads a GitHub pull request, lower-casing the repository", () => {
    expect(parseChangeRequestUrl("https://github.com/T3Tools/T3Code/pull/123")).toEqual({
      host: "github.com",
      repository: "t3tools/t3code",
      number: 123,
    });
  });

  it("reads a pull request on a GitHub Enterprise host", () => {
    expect(parseChangeRequestUrl("https://github.acme.test/platform/api/pull/7")).toEqual({
      host: "github.acme.test",
      repository: "platform/api",
      number: 7,
    });
  });

  it("reads Forgejo URLs even when the hostname contains github", () => {
    expect(parseChangeRequestUrl("https://github.internal/team/repo/pulls/7")).toEqual({
      host: "github.internal",
      authority: "github.internal",
      repository: "team/repo",
      number: 7,
    });
  });

  it("reads a supported GitHub host with a middle DNS label", () => {
    expect(parseChangeRequestUrl("https://code.github.example.com/acme/web/pull/42")).toEqual({
      host: "code.github.example.com",
      repository: "acme/web",
      number: 42,
    });
    expect(
      pullRequestCandidateUrlFromReferenceAutolink(
        "https://code.github.example.com/acme/web/issues/42",
      ),
    ).toBe("https://code.github.example.com/acme/web/pull/42");
  });

  it("reads a GitLab merge request on any host, nested groups and all", () => {
    expect(
      parseChangeRequestUrl("https://gitlab.com/t3tools/platform/t3code/-/merge_requests/42"),
    ).toEqual({ host: "gitlab.com", repository: "t3tools/platform/t3code", number: 42 });
    expect(parseChangeRequestUrl("https://code.acme.test/team/project/-/merge_requests/9")).toEqual(
      { host: "code.acme.test", repository: "team/project", number: 9 },
    );
  });

  it("reads Bitbucket and both Azure DevOps URL forms", () => {
    expect(parseChangeRequestUrl("https://bitbucket.org/workspace/repo/pull-requests/5")).toEqual({
      host: "bitbucket.org",
      repository: "workspace/repo",
      number: 5,
    });
    expect(
      parseChangeRequestUrl("https://dev.azure.com/acme/platform/_git/t3code/pullrequest/17"),
    ).toEqual({ host: "dev.azure.com", repository: "acme/platform/_git/t3code", number: 17 });
    expect(
      parseChangeRequestUrl("https://acme.visualstudio.com/platform/_git/t3code/pullrequest/17"),
    ).toEqual({ host: "acme.visualstudio.com", repository: "platform/_git/t3code", number: 17 });
  });

  it("survives trailing segments, a trailing slash and a query string", () => {
    expect(parseChangeRequestUrl("https://github.com/t3tools/t3code/pull/123/files?w=1")).toEqual({
      host: "github.com",
      repository: "t3tools/t3code",
      number: 123,
    });
    expect(parseChangeRequestUrl("https://github.com/t3tools/t3code/pull/123/")).toEqual({
      host: "github.com",
      repository: "t3tools/t3code",
      number: 123,
    });
  });

  it("claims nothing it cannot be sure of", () => {
    for (const link of [
      "https://github.com/t3tools/t3code/issues/123",
      "https://github.com/t3tools/t3code/commit/0a1b2c3",
      "https://github.com/t3tools/t3code",
      "https://github.com/t3tools/t3code/pull/abc",
      "https://gitlab.com/t3tools/t3code/-/issues/12",
      "https://blog.example.test/2026/updates/pull/3",
      "javascript:alert(1)//github.com/t3tools/t3code/pull/1",
      "not a url",
      "https://git.fryuni.dev/Owner/Repo/pulls/0",
      "https://git.fryuni.dev/Owner/Repo/pulls/9007199254740992",
      "https://git.fryuni.dev/Owner/Repo/pulls/not-a-number",
    ]) {
      expect(parseChangeRequestUrl(link), link).toBeNull();
    }
  });
});

describe("siblingPullRequestUrl", () => {
  it("recognizes Forgejo on custom HTTP hosts", () => {
    expect(parseChangeRequestUrl("http://git.example.test:3000/team/repo/pulls/42/files")).toEqual({
      host: "git.example.test",
      authority: "git.example.test:3000",
      repository: "team/repo",
      number: 42,
    });
  });
  it.each([
    [
      "https://git.example.test/Forge/Owner/Repo/pulls/42",
      "https://git.example.test/Forge/owner/repo/pulls/43",
    ],
    [
      "https://git.fryuni.dev/Owner/Repo/pulls/42/files#note",
      "https://git.fryuni.dev/owner/repo/pulls/43",
    ],
    [
      "http://forge.example.test:3000/forge/Owner/Repo/pulls/42",
      "http://forge.example.test:3000/forge/owner/repo/pulls/43",
    ],
    [
      "http://git.example.test:3000/team/repo/pulls/42/files",
      "http://git.example.test:3000/team/repo/pulls/43",
    ],
    [
      "https://git.example.test/forgejo/team/repo/pulls/42/files",
      "https://git.example.test/forgejo/team/repo/pulls/43",
    ],
    ["https://github.com/pull/1/pull/42/files", "https://github.com/pull/1/pull/43"],
    [
      "https://git.acme.test/team/merge_requests/1/repo/-/merge_requests/42/diffs",
      "https://git.acme.test/team/merge_requests/1/repo/-/merge_requests/43",
    ],

    ["https://github.com/acme/web/pull/42#discussion_r123", "https://github.com/acme/web/pull/43"],
    ["https://github.com/acme/web/pull/42/files?w=1", "https://github.com/acme/web/pull/43"],
    [
      "https://github.acme.test:8443/acme/web/pull/42/",
      "https://github.acme.test:8443/acme/web/pull/43",
    ],
    [
      "https://git.acme.test/acme/web/-/merge_requests/42/diffs",
      "https://git.acme.test/acme/web/-/merge_requests/43",
    ],
    [
      "https://bitbucket.org/acme/web/pull-requests/42",
      "https://bitbucket.org/acme/web/pull-requests/43",
    ],
    [
      "https://dev.azure.com/acme/project/_git/web/pullrequest/42?view=files",
      "https://dev.azure.com/acme/project/_git/web/pullrequest/43",
    ],
  ])("builds a canonical sibling of %s", (url, expected) => {
    expect(siblingPullRequestUrl(url, 43)).toBe(expected);
  });
  it("rejects non-PR URLs and invalid numbers", () => {
    expect(siblingPullRequestUrl("https://github.com/acme/web/issues/42", 43)).toBeNull();
    expect(siblingPullRequestUrl("https://github.com/acme/web/pull/42", 0)).toBeNull();
  });
});

describe("changeRequestUrlFor", () => {
  it("preserves the origin when the Forgejo host already contains its port", () => {
    expect(
      changeRequestUrlFor(
        "forgejo",
        "forge.example:3000",
        "team/repo",
        42,
        "http://forge.example:3000/team/repo.git",
      ),
    ).toBe("http://forge.example:3000/team/repo/pulls/42");
  });

  it.each([
    ["http://forge.example:3000/git/owner/repo.git", "http://forge.example:3000"],
    ["https://forge.example:8443/git/owner/repo.git", "https://forge.example:8443"],
    ["git@forge.example:git/owner/repo.git", "https://forge.example"],
    ["http://other.example:3000/git/owner/repo.git", "https://forge.example"],
  ])("preserves the matching Forgejo web origin from %s", (remoteUrl, origin) => {
    expect(changeRequestUrlFor("forgejo", "forge.example", "git/owner/repo", 42, remoteUrl)).toBe(
      `${origin}/git/owner/repo/pulls/42`,
    );
  });

  it.each([
    ["http://token@forge.example.test:3000/forge/owner/repo.git", "http"],
    ["https://forge.example.test:3000/forge/owner/repo.git", "https"],
    ["ssh://git@ssh.example.test:2222/owner/repo.git", "https"],
    ["git@ssh.example.test:owner/repo.git", "https"],
    ["http://other.example.test:3000/owner/repo.git", "https"],
    ["http://forge.example.test:4000/owner/repo.git", "https"],
  ])("uses the matching Forgejo web origin from %s", (remoteUrl, scheme) => {
    expect(
      changeRequestUrlFor("forgejo", "forge.example.test:3000", "forge/owner/other", 42, remoteUrl),
    ).toBe(`${scheme}://forge.example.test:3000/forge/owner/other/pulls/42`);
  });

  it.each([
    // The login-resolved web URL knows the scheme an SSH remote cannot say.
    ["ssh://git@ssh.example.test:2222/owner/repo.git", "http://forge.example.test:3000/owner/repo"],
    // It also wins over an HTTP remote that reaches the instance another way.
    ["https://forge.example.test:8443/owner/repo.git", "http://forge.example.test:3000/owner/repo"],
  ])("prefers the resolved web URL's origin over the remote %s", (remoteUrl, webUrl) => {
    expect(
      changeRequestUrlFor(
        "forgejo",
        "forge.example.test:3000",
        "owner/repo",
        42,
        remoteUrl,
        webUrl,
      ),
    ).toBe("http://forge.example.test:3000/owner/repo/pulls/42");
  });

  it("ignores a resolved web URL on another authority", () => {
    expect(
      changeRequestUrlFor(
        "forgejo",
        "forge.example.test:3000",
        "owner/repo",
        42,
        "git@ssh.example.test:owner/repo.git",
        "http://other.example.test:3000/owner/repo",
      ),
    ).toBe("https://forge.example.test:3000/owner/repo/pulls/42");
  });

  it("builds Forgejo links on the canonical web port", () => {
    const url = changeRequestUrlFor("forgejo", "forge.example.test:8443", "owner/repo", 42);
    expect(url).toBe("https://forge.example.test:8443/owner/repo/pulls/42");
    expect(parseChangeRequestUrl(url!)).toEqual({
      host: "forge.example.test",
      authority: "forge.example.test:8443",
      repository: "owner/repo",
      number: 42,
    });
  });
  it.each([
    ["ssh.dev.azure.com", "v3/org/project/web"],
    ["vs-ssh.visualstudio.com", "v3/org/project/web"],
    ["org.visualstudio.com", "defaultcollection/project/_git/web"],
    ["dev.azure.com", "org/project/_git/web"],
  ])("builds a browser URL from the Azure remote %s/%s", (host, repository) => {
    const url = changeRequestUrlFor("azure-devops", host, repository, 42);
    expect(url).toBe("https://dev.azure.com/org/project/_git/web/pullrequest/42");
    expect(parseChangeRequestUrl(url!)).toEqual({
      host: "dev.azure.com",
      repository: "org/project/_git/web",
      number: 42,
    });
  });
});

describe("Forgejo repository and stored links", () => {
  it.each([
    [
      "http://forge.example.test:3000/forge/Owner/Repo/pulls/42/files?w=1#note",
      "http://forge.example.test:3000/forge/Owner/Repo",
    ],
    [
      "https://forge.example.test/forge/pull/123/Owner/Repo/pulls/42",
      "https://forge.example.test/forge/pull/123/Owner/Repo",
    ],
    [
      "https://gitlab.example.test/group/sub/pulls/123/repo/-/merge_requests/42",
      "https://gitlab.example.test/group/sub/pulls/123/repo",
    ],
  ])("extracts the repository root from %s", (url, repositoryUrl) => {
    expect(changeRequestRepositoryUrl(url)).toBe(repositoryUrl);
  });

  it("matches stored Forgejo links without conflating instances on different ports", () => {
    const linked = {
      projectId: ProjectId.make("project-1"),
      repository: "owner/repo",
      number: 42,
      url: "https://forge.example.test:8443/Owner/Repo/pulls/42",
    };
    expect(
      matchesLinkedPullRequestUrl(
        linked,
        "https://forge.example.test:8443/owner/repo/pulls/42/files",
      ),
    ).toBe(true);
    expect(
      matchesLinkedPullRequestUrl(linked, "https://forge.example.test:9443/owner/repo/pulls/42"),
    ).toBe(false);
    expect(
      matchesLinkedPullRequestUrl(linked, "https://forge.example.test:8443/owner/repo/pulls/43"),
    ).toBe(false);
  });
});

describe("changeRequestLinkMatchesRepository", () => {
  const identity = (input: {
    provider: string;
    canonicalKey: string;
    displayName?: string;
    remoteUrl?: string;
    webUrl?: string;
  }) => ({
    canonicalKey: input.canonicalKey,
    provider: input.provider,
    locator: {
      source: "git-remote" as const,
      remoteName: "origin",
      remoteUrl:
        input.remoteUrl ?? `git@${input.canonicalKey.split("/")[0]}:${input.displayName}.git`,
    },
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    ...(input.webUrl === undefined ? {} : { webUrl: input.webUrl }),
  });
  const link = (url: string) => parseChangeRequestUrl(url)!;

  it("matches a Forgejo instance by its resolved web authority and mount path", () => {
    // Refined from an SSH alias: the clone host says nothing about the web instance.
    const aliased = identity({
      provider: "forgejo",
      canonicalKey: "forge.example:4000/git/team/repo",
      displayName: "git/team/repo",
      remoteUrl: "git@ssh.forge.example:team/repo.git",
      webUrl: "http://forge.example:4000/git/team/repo",
    });
    expect(
      changeRequestLinkMatchesRepository(
        link("http://forge.example:4000/git/Team/Repo/pulls/42"),
        aliased,
      ),
    ).toBe(true);
    for (const url of [
      "http://forge.example:3000/git/team/repo/pulls/42",
      "http://other.example:4000/git/team/repo/pulls/42",
      "http://forge.example:4000/other/team/repo/pulls/42",
      "http://forge.example:4000/Git/team/repo/pulls/42",
    ]) {
      expect(changeRequestLinkMatchesRepository(link(url), aliased), url).toBe(false);
    }
    expect(
      changeRequestLinkOnRepositoryInstance(
        link("http://forge.example:4000/git/team/other/pulls/1"),
        aliased,
      ),
    ).toBe(true);
    expect(
      changeRequestLinkOnRepositoryInstance(
        link("http://forge.example:4000/Git/team/other/pulls/1"),
        aliased,
      ),
    ).toBe(false);
    expect(
      changeRequestLinkOnRepositoryInstance(
        link("http://forge.example:3000/git/team/other/pulls/1"),
        aliased,
      ),
    ).toBe(false);
  });

  it.each([true, false])(
    "compares exact Forgejo mounts with a resolved web URL: %s",
    (resolved) => {
      for (const mount of ["", "git", "git/other", "Git"]) {
        const path = [mount, "team/repo"].filter(Boolean).join("/");
        const checkout = identity({
          provider: "forgejo",
          canonicalKey: `forge.example/${path}`,
          displayName: path,
          remoteUrl: `https://forge.example/${path}.git`,
          ...(resolved ? { webUrl: `https://forge.example/${path}` } : {}),
        });
        for (const otherMount of ["", "git", "git/other", "Git"]) {
          const otherPath = [otherMount, "another/repository"].filter(Boolean).join("/");
          expect(
            changeRequestLinkOnRepositoryInstance(
              link(`https://forge.example/${otherPath}/pulls/1`),
              checkout,
            ),
            `${mount || "(root)"} -> ${otherMount || "(root)"}`,
          ).toBe(mount === otherMount);
        }
      }
    },
  );

  it("reads the Forgejo web authority from an HTTP remote when nothing was resolved", () => {
    const projects = [3000, 4000].map((port) =>
      identity({
        provider: "forgejo",
        canonicalKey: "forge.example/git/team/repo",
        displayName: "git/team/repo",
        remoteUrl: `http://forge.example:${port}/git/team/repo.git`,
      }),
    );
    const reference = link("http://forge.example:4000/git/team/repo/pulls/42");
    expect(
      projects.map((project) => changeRequestLinkMatchesRepository(reference, project)),
    ).toEqual([false, true]);
  });

  it("matches an unresolved Forgejo SSH remote by hostname alone", () => {
    // Neither the port nor the mount is known, so the login is left to tell instances apart.
    const checkout = identity({
      provider: "forgejo",
      canonicalKey: "forge.example/git/team/repo",
      displayName: "git/team/repo",
      remoteUrl: "git@forge.example:git/team/repo.git",
    });
    expect(
      changeRequestLinkMatchesRepository(
        link("http://forge.example:4000/git/team/repo/pulls/42"),
        checkout,
      ),
    ).toBe(true);
    expect(
      changeRequestLinkMatchesRepository(
        link("http://other.example:4000/git/team/repo/pulls/42"),
        checkout,
      ),
    ).toBe(false);
  });

  it("keeps case-distinct Forgejo mount paths apart while folding owner and repository", () => {
    const projects = ["Forge", "forge"].map((mount) =>
      identity({
        provider: "forgejo",
        canonicalKey: `git.example.test/${mount}/owner/repo`,
        displayName: `${mount}/owner/repo`,
      }),
    );
    const matches = (url: string) =>
      projects.map((project) => changeRequestLinkMatchesRepository(link(url), project));
    expect(matches("https://git.example.test/Forge/Owner/Repo/pulls/7")).toEqual([true, false]);
    expect(matches("https://git.example.test/forge/Owner/Repo/pulls/7")).toEqual([false, true]);
  });

  it("matches hosted providers by hostname and the whole folded path", () => {
    const enterprise = identity({
      provider: "github",
      canonicalKey: "github.acme.test/team/web",
      displayName: "team/web",
      remoteUrl: "https://github.acme.test:8443/Team/Web.git",
    });
    // GitHub links carry no authority; a remote's HTTP port must not keep them apart.
    expect(
      changeRequestLinkMatchesRepository(
        link("https://github.acme.test/Team/Web/pull/1"),
        enterprise,
      ),
    ).toBe(true);
    expect(
      changeRequestLinkMatchesRepository(link("https://github.com/team/web/pull/1"), enterprise),
    ).toBe(false);
    const nested = identity({
      provider: "gitlab",
      canonicalKey: "gitlab.com/t3tools/platform/t3code",
      displayName: "t3tools/platform/t3code",
    });
    expect(
      changeRequestLinkMatchesRepository(
        link("https://gitlab.com/T3Tools/Platform/T3Code/-/merge_requests/1"),
        nested,
      ),
    ).toBe(true);
    expect(
      changeRequestLinkMatchesRepository(
        link("https://gitlab.com/t3tools/t3code/-/merge_requests/1"),
        nested,
      ),
    ).toBe(false);
  });

  it("matches Azure checkouts by their canonical repository whatever host they were cloned from", () => {
    const reference = link("https://dev.azure.com/org-a/project/_git/web/pullrequest/42");
    for (const canonicalKey of [
      "ssh.dev.azure.com/v3/org-a/project/web",
      "vs-ssh.visualstudio.com/v3/org-a/project/web",
      "org-a.visualstudio.com/defaultcollection/project/_git/web",
      "dev.azure.com/org-a/project/_git/web",
    ]) {
      const checkout = identity({
        provider: "azure-devops",
        canonicalKey,
        displayName: canonicalKey.split("/").slice(1).join("/"),
      });
      expect(changeRequestLinkMatchesRepository(reference, checkout), canonicalKey).toBe(true);
      expect(
        changeRequestLinkMatchesRepository(
          link("https://dev.azure.com/org-b/project/_git/web/pullrequest/42"),
          checkout,
        ),
      ).toBe(false);
    }
  });

  it("matches nothing without an identity or a repository to compare", () => {
    const reference = link("https://github.com/acme/web/pull/1");
    expect(changeRequestLinkMatchesRepository(reference, null)).toBe(false);
    expect(
      changeRequestLinkMatchesRepository(
        reference,
        identity({ provider: "github", canonicalKey: "github.com" }),
      ),
    ).toBe(false);
  });
});
