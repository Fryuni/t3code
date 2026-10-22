import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  type ServerConfig,
} from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { type Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";

const state = vi.hoisted(() => ({
  registry: undefined as AtomRegistry.AtomRegistry | undefined,
  projectsAtom: undefined as Atom.Writable<ReadonlyArray<EnvironmentProject>> | undefined,
  snapshotsReadyAtom: undefined as Atom.Writable<boolean> | undefined,
  serverConfigsAtom: undefined as
    | Atom.Writable<ReadonlyMap<EnvironmentId, ServerConfig>>
    | undefined,
}));
// Browser mocks snapshot their exports, so the registry is reached through a proxy.
vi.mock(import("../../rpc/atomRegistry"), async (original) => ({
  ...(await original()),
  appAtomRegistry: new Proxy({} as AtomRegistry.AtomRegistry, {
    get: (_, key) => {
      const value = Reflect.get(state.registry!, key);
      return typeof value === "function" ? value.bind(state.registry) : value;
    },
  }),
}));
vi.mock("../../state/projects", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../state/projects")>();
  const { Atom } = await import("effect/reactivity");
  state.projectsAtom = Atom.make<ReadonlyArray<EnvironmentProject>>([]);
  return {
    ...original,
    environmentProjects: {
      ...original.environmentProjects,
      projectsAtom: state.projectsAtom,
    },
  };
});
vi.mock("../../state/shell", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../state/shell")>();
  const { Atom } = await import("effect/reactivity");
  state.snapshotsReadyAtom = Atom.make(false);
  return { ...original, allEnvironmentProjectSnapshotsReadyAtom: state.snapshotsReadyAtom };
});
vi.mock("../../state/presentation", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../state/presentation")>();
  const { Atom } = await import("effect/reactivity");
  state.serverConfigsAtom = Atom.make<ReadonlyMap<EnvironmentId, ServerConfig>>(new Map());
  return {
    ...original,
    environmentPresentations: {
      ...original.environmentPresentations,
      serverConfigsAtom: state.serverConfigsAtom as never,
    },
  };
});
vi.mock(import("../ui/sidebar"), async (original) => ({
  ...(await original()),
  SidebarFooter: "footer" as never,
  SidebarMenu: "ul" as never,
  SidebarMenuButton: "button" as never,
  SidebarMenuItem: "li" as never,
  SidebarTrigger: "button" as never,
  useSidebar: (() => ({ isMobile: false, setOpenMobile: () => undefined })) as never,
}));
vi.mock(import("./SidebarUpdatePill"), async (original) => ({
  ...(await original()),
  SidebarUpdatePill: (() => null) as never,
  SidebarUpdateArchitectureWarning: (() => null) as never,
}));

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
} from "../../hooks/useSettings";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { environmentPresentations, environmentSummaries } from "../../state/presentation";
import { environmentProjects } from "../../state/projects";
import { allEnvironmentProjectSnapshotsReadyAtom } from "../../state/shell";
import { useUiStateStore } from "../../uiStateStore";
import {
  readPullRequestListPreferences,
  writePullRequestListPreferences,
  type PullRequestListPreferences,
} from "../pullRequest/pullRequestListPreferences";
import { SidebarUtilityMenu } from "./SidebarChrome";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const savedPreferences: PullRequestListPreferences = {
  involvement: "reviewing",
  state: "closed",
  sort: "updated",
  environmentId: local,
  projectId: ProjectId.make("previous-project"),
  host: "old.example.com",
};

function project(id: string, environmentId = local): EnvironmentProject {
  return {
    id: ProjectId.make(id),
    environmentId,
    title: id,
    workspaceRoot: `/work/${id}`,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    repositoryIdentity: null,
    faviconPath: null,
  };
}

function config(environmentId: EnvironmentId, pullRequests = true): ServerConfig {
  return {
    environment: {
      environmentId,
      label: environmentId,
      platform: { os: "linux", arch: "x64" },
      serverVersion: "test",
      capabilities: { repositoryIdentity: true, pullRequests, threadPullRequests: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "test",
    },
    cwd: "/work",
    keybindingsConfigPath: "/keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/logs",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
      otlpLogsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

function setup(): Disposable {
  localStorage.clear();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  useUiStateStore.setState({ sidebarProjectScopeKey: null });
  writePullRequestListPreferences(savedPreferences);
  return {
    [Symbol.dispose]() {
      useUiStateStore.setState({ sidebarProjectScopeKey: null });
      __resetClientSettingsPersistenceForTests();
      localStorage.clear();
    },
  };
}

async function mount(
  projects: EnvironmentProject[],
  configs = [config(local), config(remote)],
  snapshotsReady = true,
) {
  await using stack = new AsyncDisposableStack();
  const registry = AtomRegistry.make({
    initialValues: [
      [environmentProjects.projectsAtom, projects],
      [primaryEnvironmentIdAtom, local],
      [environmentSummaries.pullRequestsSupportedAtom, true],
      [allEnvironmentProjectSnapshotsReadyAtom, snapshotsReady],
      [
        environmentPresentations.serverConfigsAtom,
        new Map(configs.map((value) => [value.environment.environmentId, value])),
      ],
    ],
  });
  state.registry = registry;
  stack.defer(() => registry.dispose());
  const rootRoute = createRootRoute({ component: SidebarUtilityMenu });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: "/" }),
      createRoute({ getParentRoute: () => rootRoute, path: "/pull-requests" }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const screen = stack.use(
    // router: false because the menu navigates to /pull-requests, which the test router lacks.
    await render(
      <RegistryContext.Provider value={registry}>
        <RouterProvider router={router} />
      </RegistryContext.Provider>,
      { router: false },
    ),
  );
  const pullRequestsButton = () => {
    const button = screen.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Pull Requests"]',
    );
    if (!button) throw new Error("Pull Requests button is missing");
    return button;
  };
  const owned = stack.move();
  return {
    router,
    pullRequestsButton,
    openPullRequests: () =>
      act(() => {
        pullRequestsButton().click();
      }),
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}

describe("opening pull requests from the sidebar", () => {
  it("uses the current sidebar project and its environment instead of the saved scope", async () => {
    using _setup = setup();
    const current = project("current-project", remote);
    useUiStateStore.getState().setSidebarProjectScopeKey(`${remote}:${current.workspaceRoot}`);
    await using mounted = await mount([project("current-project"), current]);

    await mounted.openPullRequests();

    expect(mounted.router.state.location.pathname).toBe("/pull-requests");
    expect(mounted.router.state.location.search).toEqual({
      involvement: "reviewing",
      state: "closed",
      sort: "updated",
      environmentId: remote,
      projectId: current.id,
    });
  });

  it.each([null, "missing-project"])(
    "clears the saved scope when the sidebar scope is %s",
    async (scopeKey) => {
      using _setup = setup();
      useUiStateStore.getState().setSidebarProjectScopeKey(scopeKey);
      await using mounted = await mount([project("current-project")]);

      await mounted.openPullRequests();

      expect(mounted.router.state.location.search).toEqual({
        involvement: "reviewing",
        state: "closed",
        sort: "updated",
      });
    },
  );

  it("reads the current scope again on every opening", async () => {
    using _setup = setup();
    const first = project("first-project");
    const second = project("second-project", remote);
    await using mounted = await mount([first, second]);
    await act(() => {
      useUiStateStore.getState().setSidebarProjectScopeKey(`${local}:${first.workspaceRoot}`);
    });
    await mounted.openPullRequests();
    expect(mounted.router.state.location.search).toMatchObject({
      projectId: first.id,
      environmentId: local,
    });

    await act(() => mounted.router.navigate({ to: "/" }));
    writePullRequestListPreferences({ ...savedPreferences, projectId: first.id });
    await act(() => {
      useUiStateStore.getState().setSidebarProjectScopeKey(`${remote}:${second.workspaceRoot}`);
    });
    await mounted.openPullRequests();
    expect(mounted.router.state.location.search).toMatchObject({
      projectId: second.id,
      environmentId: remote,
    });

    await act(() => mounted.router.navigate({ to: "/" }));
    await act(() => {
      useUiStateStore.getState().setSidebarProjectScopeKey(null);
    });
    await mounted.openPullRequests();
    expect(mounted.router.state.location.search).not.toHaveProperty("projectId");
    expect(mounted.router.state.location.search).not.toHaveProperty("environmentId");
  });

  it("keeps an unresolved scope while snapshots load and opens it when its project arrives", async () => {
    using _setup = setup();
    const current = project("current-project", remote);
    const scopeKey = `${remote}:${current.workspaceRoot}`;
    useUiStateStore.getState().setSidebarProjectScopeKey(scopeKey);
    await using mounted = await mount([project("other-project")], undefined, false);

    expect(mounted.pullRequestsButton().disabled).toBe(true);
    await mounted.openPullRequests();

    expect(mounted.router.state.location.pathname).toBe("/");
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe(scopeKey);
    expect(readPullRequestListPreferences()).toEqual(savedPreferences);

    await act(() => {
      state.registry!.set(state.projectsAtom!, [current]);
    });
    expect(state.registry!.get(allEnvironmentProjectSnapshotsReadyAtom)).toBe(false);
    expect(mounted.pullRequestsButton().disabled).toBe(false);
    expect(mounted.router.state.location.pathname).toBe("/");
    await mounted.openPullRequests();

    expect(mounted.router.state.location.pathname).toBe("/pull-requests");
    expect(mounted.router.state.location.search).toEqual({
      involvement: "reviewing",
      state: "closed",
      sort: "updated",
      environmentId: remote,
      projectId: current.id,
    });
  });

  it("opens All projects for a missing scope only after live snapshots establish its absence", async () => {
    using _setup = setup();
    useUiStateStore.getState().setSidebarProjectScopeKey("missing-project");
    await using mounted = await mount([], undefined, false);

    expect(mounted.pullRequestsButton().disabled).toBe(true);
    await mounted.openPullRequests();
    expect(mounted.router.state.location.pathname).toBe("/");
    expect(readPullRequestListPreferences()).toEqual(savedPreferences);

    await act(() => {
      state.registry!.set(state.snapshotsReadyAtom!, true);
    });
    expect(mounted.pullRequestsButton().disabled).toBe(false);
    expect(mounted.router.state.location.pathname).toBe("/");
    await mounted.openPullRequests();

    expect(mounted.router.state.location.pathname).toBe("/pull-requests");
    expect(mounted.router.state.location.search).toEqual({
      involvement: "reviewing",
      state: "closed",
      sort: "updated",
    });
  });

  it("allows switching to All projects while snapshots are still loading", async () => {
    using _setup = setup();
    useUiStateStore.getState().setSidebarProjectScopeKey("unloaded-project");
    await using mounted = await mount([], undefined, false);

    expect(mounted.pullRequestsButton().disabled).toBe(true);
    await act(() => {
      useUiStateStore.getState().setSidebarProjectScopeKey(null);
    });
    expect(mounted.pullRequestsButton().disabled).toBe(false);
    await mounted.openPullRequests();

    expect(mounted.router.state.location.pathname).toBe("/pull-requests");
    expect(mounted.router.state.location.search).toEqual({
      involvement: "reviewing",
      state: "closed",
      sort: "updated",
    });
  });

  it.each(["unsupported", "connecting"] as const)(
    "preserves a selected project while its server is %s, then opens it once capable",
    async (serverState) => {
      using _setup = setup();
      const current = project("shared-project-id", remote);
      const scopeKey = `${remote}:${current.workspaceRoot}`;
      useUiStateStore.getState().setSidebarProjectScopeKey(scopeKey);
      const configs =
        serverState === "unsupported" ? [config(local), config(remote, false)] : [config(local)];
      await using mounted = await mount([project("shared-project-id"), current], configs);

      expect(mounted.pullRequestsButton().disabled).toBe(true);
      await mounted.openPullRequests();
      expect(mounted.router.state.location.pathname).toBe("/");
      expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe(scopeKey);
      expect(readPullRequestListPreferences()).toEqual(savedPreferences);

      await act(() => {
        useUiStateStore.getState().setSidebarProjectScopeKey(null);
      });
      expect(mounted.pullRequestsButton().disabled).toBe(false);
      await mounted.openPullRequests();
      expect(mounted.router.state.location.pathname).toBe("/pull-requests");
      expect(mounted.router.state.location.search).toEqual({
        involvement: "reviewing",
        state: "closed",
        sort: "updated",
      });

      await act(() => mounted.router.navigate({ to: "/" }));
      await act(() => {
        useUiStateStore.getState().setSidebarProjectScopeKey(scopeKey);
      });
      expect(mounted.pullRequestsButton().disabled).toBe(true);
      await act(() => {
        state.registry!.set(
          state.serverConfigsAtom!,
          new Map([
            [local, config(local)],
            [remote, config(remote)],
          ]),
        );
      });
      expect(mounted.pullRequestsButton().disabled).toBe(false);
      expect(mounted.router.state.location.pathname).toBe("/");
      await mounted.openPullRequests();

      expect(mounted.router.state.location.pathname).toBe("/pull-requests");
      expect(mounted.router.state.location.search).toEqual({
        involvement: "reviewing",
        state: "closed",
        sort: "updated",
        environmentId: remote,
        projectId: current.id,
      });
    },
  );

  it.each([
    { localSupported: true, projectId: "local-checkout", environmentId: local },
    { localSupported: false, projectId: "remote-checkout", environmentId: remote },
  ])(
    "resolves a repository group to the capable $projectId",
    async ({ localSupported, projectId, environmentId }) => {
      using _setup = setup();
      const canonicalKey = "github.com/acme/repo";
      const projects = [project("remote-checkout", remote), project("local-checkout")].map(
        (checkout) => ({
          ...checkout,
          repositoryIdentity: {
            provider: "github",
            canonicalKey,
            displayName: "acme/repo",
            webUrl: `https://${canonicalKey}`,
            locator: {
              source: "git-remote" as const,
              remoteName: "origin",
              remoteUrl: `https://${canonicalKey}.git`,
            },
          },
        }),
      );
      useUiStateStore.getState().setSidebarProjectScopeKey(canonicalKey);
      await using mounted = await mount(projects, [config(local, localSupported), config(remote)]);

      await mounted.openPullRequests();

      expect(mounted.router.state.location.search).toMatchObject({
        projectId,
        environmentId,
      });
    },
  );

  it("ignores a hidden project scope in legacy mode while snapshots are loading", async () => {
    using _setup = setup();
    __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, legacySidebarEnabled: true });
    const current = project("current-project");
    useUiStateStore.getState().setSidebarProjectScopeKey(`${local}:${current.workspaceRoot}`);
    await using mounted = await mount([], undefined, false);

    expect(mounted.pullRequestsButton().disabled).toBe(false);
    await mounted.openPullRequests();

    expect(mounted.router.state.location.pathname).toBe("/pull-requests");
    expect(mounted.router.state.location.search).toEqual({
      involvement: "reviewing",
      state: "closed",
      sort: "updated",
    });
  });
});
