import { SourceControlProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  CommandId,
  SourceControlDiscoveryResult,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

import {
  buildAddProjectRemoteSourceReadiness,
  buildProjectCreateCommand,
  canCreateProjectInEnvironment,
  findExistingAddProject,
  getAddProjectInitialQuery,
  getCloneDestinationBrowsePath,
  getCloneDestinationPath,
  getCloneDirectoryName,
  getDefaultCloneUrl,
  getNewProjectPublishTarget,
  getNewProjectPublishTargets,
  normalizePastedCloneUrl,
  projectCheckoutCloneUrl,
  projectCheckoutOptions,
  projectCheckoutTitle,
  resolveAddProjectPath,
  sortAddProjectProviderSources,
} from "./projects.ts";
import type { EnvironmentProject } from "../state/models.ts";

describe("add project shared logic", () => {
  it("only allows project creation in connected environments", () => {
    expect(canCreateProjectInEnvironment("connected")).toBe(true);
    expect(canCreateProjectInEnvironment("available")).toBe(false);
    expect(canCreateProjectInEnvironment("offline")).toBe(false);
    expect(canCreateProjectInEnvironment("connecting")).toBe(false);
    expect(canCreateProjectInEnvironment("reconnecting")).toBe(false);
    expect(canCreateProjectInEnvironment("error")).toBe(false);
  });

  it("resolves initial browse paths from settings", () => {
    expect(getAddProjectInitialQuery("")).toBe("~/");
    expect(getAddProjectInitialQuery("/work")).toBe("/work/");
    expect(getAddProjectInitialQuery("C:\\work")).toBe("C:\\work\\");
  });

  it("derives the clone folder name from the repository name with owner", () => {
    expect(getCloneDirectoryName("owner/repo")).toBe("repo");
    expect(getCloneDirectoryName("org/project/repo")).toBe("repo");
    expect(getCloneDirectoryName("repo")).toBe("repo");
    expect(getCloneDirectoryName("owner/repo/")).toBe("repo");
    expect(getCloneDirectoryName("")).toBe("");
    expect(getCloneDirectoryName(null)).toBe("");
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

  it("preserves existing clone transport behavior for other providers", () => {
    expect(
      getDefaultCloneUrl({
        provider: SourceControlProviderKind.make("gitlab"),
        url: "https://gitlab.com/group/project.git",
        sshUrl: "git@gitlab.com:group/project.git",
      }),
    ).toBe("git@gitlab.com:group/project.git");
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

  it("keeps a numeric repository name that sits on a path", () => {
    expect(getCloneDirectoryName("https://github.com/acme/123.git")).toBe("123");
    expect(getCloneDirectoryName("https://github.com/acme/123")).toBe("123");
    expect(getCloneDirectoryName("git@github.com:acme/123.git")).toBe("123");
  });

  it("proposes no clone folder for a link that names no repository", () => {
    expect(getCloneDirectoryName("https://github.com/")).toBe("");
    expect(getCloneDirectoryName("https://github.com")).toBe("");
    expect(getCloneDirectoryName("git@github.com:")).toBe("");
    expect(getCloneDirectoryName("ssh://git@github.com:22")).toBe("");
    expect(getCloneDirectoryName("https://")).toBe("");
  });

  it("proposes the clone destination inside the selected directory", () => {
    expect(getCloneDestinationPath("~/Projects/", "repo")).toBe("~/Projects/repo");
    expect(getCloneDestinationPath("~/Projects", "repo")).toBe("~/Projects/repo");
    expect(getCloneDestinationPath("C:\\work\\", "repo")).toBe("C:\\work\\repo");
    expect(getCloneDestinationPath("~/Projects/", null)).toBe("~/Projects/");
    expect(getCloneDestinationPath("~/Projects/", "")).toBe("~/Projects/");
  });

  it("keeps pinned clone destinations anchored to the browsed directory", () => {
    expect(
      getCloneDestinationBrowsePath({
        browseDirectoryPath: "~/Projects/",
        selectedDirectoryName: "work",
        cloneDirectoryName: "repo",
        caseSensitive: true,
      }),
    ).toBe("~/Projects/work/repo");
    expect(
      getCloneDestinationBrowsePath({
        browseDirectoryPath: "~/Projects/",
        selectedDirectoryName: "repo",
        cloneDirectoryName: "repo",
        caseSensitive: true,
      }),
    ).toBe("~/Projects/repo/");
    expect(
      getCloneDestinationBrowsePath({
        browseDirectoryPath: "C:\\Projects\\",
        selectedDirectoryName: "Repo",
        cloneDirectoryName: "repo",
        caseSensitive: false,
      }),
    ).toBe("C:\\Projects\\Repo\\");
  });

  it("rejects unsupported windows paths on non-windows environments", () => {
    expect(
      resolveAddProjectPath({
        rawPath: "C:\\repo",
        platform: "MacIntel",
        currentProjectCwd: null,
      }),
    ).toEqual({
      ok: false,
      error: "Windows-style paths are only supported on Windows environments.",
    });
  });

  it("resolves relative paths from the active project cwd", () => {
    expect(
      resolveAddProjectPath({
        rawPath: "../next",
        platform: "Linux",
        currentProjectCwd: "/work/current",
      }),
    ).toEqual({ ok: true, path: "/work/next" });
  });

  it("marks authenticated source control providers as ready", () => {
    const discovery: SourceControlDiscoveryResult = {
      versionControlSystems: [],
      sourceControlProviders: [
        {
          kind: SourceControlProviderKind.make("github"),
          label: "GitHub",
          status: "available",
          installHint: "Install gh",
          version: Option.some("1.0.0"),
          detail: Option.none(),
          auth: {
            status: "authenticated",
            account: Option.some("octo"),
            host: Option.some("github.com"),
            detail: Option.none(),
          },
        },
        {
          kind: SourceControlProviderKind.make("gitlab"),
          label: "GitLab",
          status: "available",
          installHint: "Install glab",
          version: Option.some("1.0.0"),
          detail: Option.none(),
          auth: {
            status: "unauthenticated",
            account: Option.none(),
            host: Option.none(),
            detail: Option.some("Run glab auth login"),
          },
        },
      ],
    };

    const readiness = buildAddProjectRemoteSourceReadiness(discovery);
    expect(readiness("url").ready).toBe(true);
    expect(readiness(SourceControlProviderKind.make("github")).ready).toBe(true);
    expect(readiness(SourceControlProviderKind.make("gitlab"))).toEqual({
      ready: false,
      hint: "Run glab auth login",
    });
    expect(sortAddProjectProviderSources(readiness)[0]).toBe("github");
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

  it("builds the V2 project.create mutation", () => {
    expect(
      buildProjectCreateCommand({
        commandId: CommandId.make("command"),
        projectId: ProjectId.make("project"),
        workspaceRoot: "/work/repo",
      }),
    ).toMatchObject({
      type: "project.create",
      commandId: "command",
      projectId: "project",
      title: "repo",
      workspaceRoot: "/work/repo",
      createWorkspaceRootIfMissing: true,
      defaultModelSelection: null,
    });
  });
});

describe("new project publish targets", () => {
  const readyHost = (kind: string, account: string | null) => ({
    kind: SourceControlProviderKind.make(kind),
    label: kind,
    status: "available" as const,
    installHint: "",
    version: Option.none(),
    detail: Option.none(),
    auth: {
      status: "authenticated" as const,
      account: Option.fromNullOr(account),
      host: Option.none(),
      detail: Option.none(),
    },
  });

  it("offers ready hosts that can place the repository, GitHub first, and keeps the pick", () => {
    const targets = getNewProjectPublishTargets({
      versionControlSystems: [],
      sourceControlProviders: [
        readyHost("gitlab", "group"),
        readyHost("github", null),
        readyHost("azure-devops", "me"),
      ],
    });
    expect(targets.map((target) => target.definition.kind)).toEqual(["github", "gitlab"]);
    expect(getNewProjectPublishTarget(targets, null)?.definition.kind).toBe("github");
    expect(
      getNewProjectPublishTarget(targets, SourceControlProviderKind.make("gitlab"))?.owner,
    ).toBe("group");
  });
});

describe("projectCheckoutOptions", () => {
  const laptop = { environmentId: "laptop" };
  const server = { environmentId: "server" };
  const options = (overrides: Partial<Parameters<typeof projectCheckoutOptions>[0]> = {}) =>
    projectCheckoutOptions({
      connectedEnvironments: [laptop, server],
      checkoutEnvironmentIds: ["laptop"],
      checkoutCount: 1,
      canCheckOut: true,
      ...overrides,
    });

  it("offers connected machines without a checkout", () => {
    expect(options()).toEqual({ visible: true, targets: [server] });
  });

  it("offers no machine once every connected one has a checkout", () => {
    expect(options({ checkoutEnvironmentIds: ["laptop", "server"], checkoutCount: 2 })).toEqual({
      visible: true,
      targets: [],
    });
  });

  it("offers the connected machine while the only checkout's machine is offline", () => {
    expect(options({ connectedEnvironments: [server] })).toEqual({
      visible: true,
      targets: [server],
    });
  });

  it("hides the section when only one machine is connected", () => {
    expect(options({ connectedEnvironments: [laptop] })).toEqual({
      visible: false,
      targets: [],
    });
  });

  it("keeps listing several checkouts when only one machine is connected", () => {
    expect(
      options({
        connectedEnvironments: [laptop],
        checkoutEnvironmentIds: ["laptop", "laptop"],
        checkoutCount: 2,
      }).visible,
    ).toBe(true);
  });

  it("hides the section for a lone checkout that cannot gain another", () => {
    expect(options({ canCheckOut: false })).toEqual({ visible: false, targets: [] });
  });

  it("keeps listing several checkouts that cannot gain another", () => {
    expect(
      options({
        canCheckOut: false,
        checkoutEnvironmentIds: ["laptop", "server"],
        checkoutCount: 2,
      }),
    ).toEqual({ visible: true, targets: [] });
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
