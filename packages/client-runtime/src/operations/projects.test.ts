import { SourceControlProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";

import {
  findExistingAddProject,
  getCloneDestinationForPickedFolder,
  getCloneDestinationPath,
  getCloneDirectoryLeafName,
  getCloneDirectoryName,
  getCloneDirectoryPath,
  getDefaultCloneUrl,
  githubIncompleteOwnerRepositoryMessage,
  normalizePastedCloneUrl,
  projectCheckoutCloneUrl,
  projectCheckoutTargets,
  projectCheckoutTitle,
  sortAddProjectProviderSources,
} from "./projects.ts";
import type { EnvironmentProject } from "../state/models.ts";

describe("add project shared logic", () => {
  it("offers only GitHub until other hosts are turned on", () => {
    const ready = () => ({ ready: true, hint: null });
    expect(sortAddProjectProviderSources(ready, {})).toEqual(["github"]);
    expect(sortAddProjectProviderSources(ready, { gitlab: true, github: false })).toEqual([
      "gitlab",
    ]);
  });

  it("asks for a repository name when GitHub input is only an owner path", () => {
    const github = SourceControlProviderKind.make("github");
    expect(githubIncompleteOwnerRepositoryMessage(github, "pingdotgg/")).toBe(
      "Enter the full owner/repository name.",
    );
    expect(githubIncompleteOwnerRepositoryMessage(github, "  pingdotgg//  ")).toBe(
      "Enter the full owner/repository name.",
    );
    expect(githubIncompleteOwnerRepositoryMessage(github, "mona-cat_octo/")).toBe(
      "Enter the full owner/repository name.",
    );

    for (const input of [
      "pingdotgg/t3code",
      "mona-cat_octo/repo",
      "pingdotgg",
      "https://github.com/pingdotgg/t3code.git",
      "git@github.com:pingdotgg/t3code.git",
    ]) {
      expect(githubIncompleteOwnerRepositoryMessage(github, input)).toBeNull();
    }
    expect(
      githubIncompleteOwnerRepositoryMessage(SourceControlProviderKind.make("gitlab"), "group/"),
    ).toBeNull();
    expect(githubIncompleteOwnerRepositoryMessage("url", "owner/")).toBeNull();
    expect(
      githubIncompleteOwnerRepositoryMessage(SourceControlProviderKind.make("forgejo"), "owner/"),
    ).toBeNull();
  });

  it("routes owner/repository shorthand to GitHub over HTTPS", () => {
    expect(normalizePastedCloneUrl("imputnet/helium")).toBe(
      "https://github.com/imputnet/helium.git",
    );
    expect(normalizePastedCloneUrl("  pingdotgg/t3code  ")).toBe(
      "https://github.com/pingdotgg/t3code.git",
    );
  });

  it("keeps explicit clone URLs and local paths unchanged", () => {
    expect(normalizePastedCloneUrl("https://gitlab.com/group/project.git")).toBe(
      "https://gitlab.com/group/project.git",
    );
    expect(normalizePastedCloneUrl("git@github.com:owner/repo.git")).toBe(
      "git@github.com:owner/repo.git",
    );
    expect(normalizePastedCloneUrl("group/subgroup/project")).toBe("group/subgroup/project");
    expect(normalizePastedCloneUrl("/srv/git/repo.git")).toBe("/srv/git/repo.git");
    for (const gitlabProject of [
      "https://gitlab.com/acme/tools/src/branch/worker.git",
      "https://scm.example.test/acme/tools/src/branch/worker.git",
      "https://scm.example.test/acme/tools/src/branch/worker",
      "https://scm.example.test/team/repo/src/branch/main/-/README.md",
      "https://forgejo.example.test/a/b/src/branch/mount/team/repo.git",
    ]) {
      expect(normalizePastedCloneUrl(gitlabProject)).toBe(gitlabProject);
    }
  });

  it("clones the repository when given a page URL copied from the browser", () => {
    for (const [pageUrl, pageRoute, repository] of [
      ["https://github.com/pingdotgg/t3code/tree/main", "/tree/", "t3code"],
      ["https://gitlab.com/gitlab-org/gitlab-runner/-/tree/main", "/-/", "gitlab-runner"],
      ["https://git.cafe/pingdotgg/t3code/tree/main", "/tree/", "t3code"],
      ["https://gitlab.example.test/g/p/-/blob/main/src/branch/x", "/-/", "p"],
      ["https://code.company.test/g/p/-/tree/main", "/-/", "p"],
      ["https://github.com/pingdotgg/t3code/tree/release.git", "/tree/", "t3code"],
    ] as const) {
      const cloneUrl = normalizePastedCloneUrl(pageUrl);
      expect(cloneUrl).not.toContain(pageRoute);
      expect(getCloneDirectoryName(cloneUrl)).toBe(repository);
    }
    expect(
      normalizePastedCloneUrl("https://alice:example@bitbucket.org/workspace/repo/src/master/"),
    ).toBe("https://alice:example@bitbucket.org/workspace/repo");
  });

  it("uses HTTPS for repositories selected through a provider", () => {
    expect(
      getDefaultCloneUrl({
        provider: SourceControlProviderKind.make("github"),
        url: "https://github.com/imputnet/helium",
        sshUrl: "git@github.com:imputnet/helium.git",
      }),
    ).toBe("https://github.com/imputnet/helium");
    expect(
      getDefaultCloneUrl({
        provider: SourceControlProviderKind.make("forgejo"),
        url: "https://forgejo.example.test:8443/owner/repo.git",
        sshUrl: "ssh://git@forgejo.example.test:2222/owner/repo.git",
      }),
    ).toBe("https://forgejo.example.test:8443/owner/repo.git");
  });

  it("derives the clone folder name from any pasted clone URL", () => {
    expect(getCloneDirectoryName("https://github.com/owner/repo.git")).toBe("repo");
    expect(getCloneDirectoryName("https://github.com/owner/repo")).toBe("repo");
    expect(getCloneDirectoryName("https://github.com/owner/repo/")).toBe("repo");
    expect(getCloneDirectoryName("git@github.com:owner/repo.git")).toBe("repo");
    expect(getCloneDirectoryName("ssh://git@github.com:22/owner/repo.git")).toBe("repo");
    expect(getCloneDirectoryName("https://user@bitbucket.org/owner/repo.git")).toBe("repo");
    expect(getCloneDirectoryName("https://dev.azure.com/org/project/_git/repo")).toBe("repo");
    expect(getCloneDirectoryName("https://github.com/owner/repo.git?ref=main#readme")).toBe("repo");
    expect(getCloneDirectoryName("/srv/git/repo.git")).toBe("repo");
    expect(getCloneDirectoryName("C:\\src\\repo.git")).toBe("repo");
    expect(getCloneDirectoryName("git@github.com:repo.git")).toBe("repo");
    expect(getCloneDirectoryName("  https://github.com/owner/repo.git  ")).toBe("repo");
  });

  it("lays clone folders out like ghq only when asked, and only when the URL is safe", () => {
    expect(getCloneDirectoryPath("git@github.com:owner/repo.git", false)).toBe("repo");
    expect(getCloneDirectoryPath("git@github.com:owner/repo.git", true)).toBe(
      "github.com/owner/repo",
    );
    expect(getCloneDirectoryPath("ssh://git@gitlab.com:2222/group/sub/repo.git", true)).toBe(
      "gitlab.com/group/sub/repo",
    );
    expect(getCloneDirectoryPath("https://github.com/owner/../../repo", true)).toBe("repo");
    expect(getCloneDirectoryPath("/srv/git/repo.git", true)).toBe("repo");
    expect(
      getCloneDirectoryPath(
        "git@ssh.dev.azure.com:v3/org/Project/My%20Repo",
        false,
        "Project/My Repo",
      ),
    ).toBe("My Repo");
    expect(
      getCloneDirectoryLeafName(
        "git@ssh.dev.azure.com:v3/org/Project/My%20Repo",
        true,
        "Project/My Repo",
      ),
    ).toBe("My%20Repo");
    expect(
      getCloneDestinationPath(
        "C:\\Users\\me\\ghq",
        getCloneDirectoryPath("git@github.com:owner/repo.git", true),
      ),
    ).toBe("C:\\Users\\me\\ghq\\github.com\\owner\\repo");
  });

  it("keeps a numeric repository name that sits on a path", () => {
    expect(getCloneDirectoryName("https://github.com/acme/123.git")).toBe("123");
    expect(getCloneDirectoryName("https://github.com/acme/123")).toBe("123");
    expect(getCloneDirectoryName("git@github.com:acme/123.git")).toBe("123");
  });

  it("resolves a native-picker folder like an in-app clone selection", () => {
    const pick = (pickedPath: string, caseSensitive = true) =>
      getCloneDestinationForPickedFolder({
        pickedPath,
        cloneDirectoryName: "repo",
        caseSensitive,
      });

    expect(pick("/Users/me/code")).toBe("/Users/me/code/repo");
    expect(pick("/Users/me/code/")).toBe("/Users/me/code/repo");
    expect(pick("/Users/me/repo")).toBe("/Users/me/repo/");
    expect(pick("/Users/me/Repo")).toBe("/Users/me/Repo/repo");
    expect(pick("C:\\Projects\\Repo", false)).toBe("C:\\Projects\\Repo\\");
    expect(pick("C:\\Projects", false)).toBe("C:\\Projects\\repo");
    expect(pick("/")).toBe("/repo");
  });

  it("finds existing projects by normalized path in the target environment", () => {
    const env = EnvironmentId.make("env");
    const other = EnvironmentId.make("other");
    const projects: EnvironmentProject[] = [
      {
        environmentId: other,
        id: ProjectId.make("same-path-other-env"),
        title: "Other",
        workspaceRoot: "/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
      },
      {
        environmentId: env,
        id: ProjectId.make("project"),
        title: "Repo",
        workspaceRoot: "/repo/",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
      },
    ];

    expect(findExistingAddProject({ projects, environmentId: env, path: "/repo" })?.id).toBe(
      "project",
    );
  });
});

describe("projectCheckoutTargets", () => {
  const laptop = { environmentId: "laptop" };
  const server = { environmentId: "server" };
  const targets = (overrides: Partial<Parameters<typeof projectCheckoutTargets>[0]> = {}) =>
    projectCheckoutTargets({
      connectedEnvironments: [laptop, server],
      checkoutEnvironmentIds: ["laptop"],
      canCheckOut: true,
      ...overrides,
    });

  it("offers connected machines without a checkout", () => {
    expect(targets()).toEqual([server]);
  });

  it("offers no machine once every connected one has a checkout", () => {
    expect(targets({ checkoutEnvironmentIds: ["laptop", "server"] })).toEqual([]);
  });

  it("offers the connected machine while the only checkout's machine is offline", () => {
    expect(targets({ connectedEnvironments: [server] })).toEqual([server]);
  });

  it("offers no machine for a project that cannot gain another checkout", () => {
    expect(targets({ canCheckOut: false })).toEqual([]);
  });
});

describe("projectCheckoutTitle", () => {
  it("keeps the title every checkout shares", () => {
    expect(projectCheckoutTitle([{ title: "My App" }, { title: "My App" }])).toBe("My App");
  });

  it("leaves the title to the clone when checkouts disagree", () => {
    expect(projectCheckoutTitle([{ title: "My App" }, { title: "t3code" }])).toBeUndefined();
  });
});

describe("projectCheckoutCloneUrl", () => {
  const identity = {
    canonicalKey: "github.com/t3tools/t3code",
    locator: {
      source: "git-remote" as const,
      remoteName: "upstream",
      remoteUrl: "git@github.com:T3Tools/t3code.git",
    },
    rootPath: "/work/t3code",
  };

  it("clones the repository remote for a project at the repository root", () => {
    expect(
      projectCheckoutCloneUrl({ workspaceRoot: "/work/t3code/", repositoryIdentity: identity }),
    ).toBe("git@github.com:T3Tools/t3code.git");
  });

  it("clones a fork from its origin rather than its upstream", () => {
    expect(
      projectCheckoutCloneUrl({
        workspaceRoot: "/work/t3code",
        repositoryIdentity: {
          ...identity,
          origin: {
            canonicalKey: "github.com/julius/t3code-fork",
            remoteUrl: "git@github.com:julius/t3code-fork.git",
          },
        },
      }),
    ).toBe("git@github.com:julius/t3code-fork.git");
  });

  it("offers no clone when a fork's origin URL is unknown", () => {
    expect(
      projectCheckoutCloneUrl({
        workspaceRoot: "/work/t3code",
        repositoryIdentity: {
          ...identity,
          origin: { canonicalKey: "github.com/julius/t3code-fork" },
        },
      }),
    ).toBeNull();
  });

  it("offers no clone for a project in a repository subdirectory", () => {
    expect(
      projectCheckoutCloneUrl({
        workspaceRoot: "/work/t3code/apps/web",
        repositoryIdentity: identity,
      }),
    ).toBeNull();
  });

  it("clones without the source machine's credentials", () => {
    expect(
      projectCheckoutCloneUrl({
        workspaceRoot: "/work/t3code",
        repositoryIdentity: {
          ...identity,
          locator: {
            ...identity.locator,
            remoteUrl: "https://julius:ghp_token@github.com/T3Tools/t3code.git",
          },
        },
      }),
    ).toBe("https://github.com/T3Tools/t3code.git");
  });

  it.each([
    "/srv/git/t3code.git",
    "../t3code.git",
    "file:///srv/git/t3code.git",
    "C:\\git\\t3code",
    "https://localhost/t3code.git",
    "ssh://git@127.0.0.1/t3code.git",
    "ssh://git@[::1]:2222/t3code.git",
    "git@localhost:t3code.git",
    "git@[::1]:t3code.git",
    "custom::/srv/git/t3code",
    "codecommit::us-east-1://t3code",
    "custom://host.test/t3code",
    "git@127.1:t3code.git",
    "ssh://git@0x7f.1/t3code.git",
    "ssh://git@[::ffff:127.0.0.1]/t3code.git",
  ])("offers no clone of the machine-local remote %s", (remoteUrl) => {
    expect(
      projectCheckoutCloneUrl({
        workspaceRoot: "/work/t3code",
        repositoryIdentity: { ...identity, locator: { ...identity.locator, remoteUrl } },
      }),
    ).toBeNull();
  });

  it("clones network remotes, including scp-like ones", () => {
    for (const remoteUrl of [
      "git@github.com:T3Tools/t3code.git",
      "git@[2001:db8::1]:T3Tools/t3code.git",
      "ssh://git@host.test/t3code",
      "https://host.test/t3code.git",
      "git://host.test/t3code.git",
    ]) {
      expect(
        projectCheckoutCloneUrl({
          workspaceRoot: "/work/t3code",
          repositoryIdentity: { ...identity, locator: { ...identity.locator, remoteUrl } },
        }),
      ).toBe(remoteUrl);
    }
  });

  it("offers no clone when the repository root is unknown", () => {
    const { rootPath: _rootPath, ...withoutRoot } = identity;
    expect(
      projectCheckoutCloneUrl({ workspaceRoot: "/work/t3code", repositoryIdentity: withoutRoot }),
    ).toBeNull();
  });

  it("offers no clone without a repository", () => {
    expect(projectCheckoutCloneUrl({ workspaceRoot: "/work/notes" })).toBeNull();
  });
});
