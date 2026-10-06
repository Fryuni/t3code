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
import { type Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  registry: undefined as AtomRegistry.AtomRegistry | undefined,
  projectsAtom: undefined as Atom.Writable<ReadonlyArray<EnvironmentProject>> | undefined,
  snapshotsReadyAtom: undefined as Atom.Writable<boolean> | undefined,
  serverConfigsAtom: undefined as
    | Atom.Writable<ReadonlyMap<EnvironmentId, ServerConfig>>
    | undefined,
}));
vi.mock("../../rpc/atomRegistry", () => ({
  get appAtomRegistry() {
    return state.registry;
  },
}));
vi.mock("../../state/projects", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../state/projects")>();
  const { Atom } = await import("effect/unstable/reactivity");
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
  const { Atom } = await import("effect/unstable/reactivity");
  state.snapshotsReadyAtom = Atom.make(false);
  return { ...original, allEnvironmentProjectSnapshotsReadyAtom: state.snapshotsReadyAtom };
});
vi.mock("../../state/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../state/server")>();
  const { Atom } = await import("effect/unstable/reactivity");
  state.serverConfigsAtom = Atom.make<ReadonlyMap<EnvironmentId, ServerConfig>>(new Map());
  return { ...original, environmentServerConfigsAtom: state.serverConfigsAtom };
});
vi.mock("../ui/sidebar", () => ({
  SidebarFooter: "footer",
  SidebarMenu: "ul",
  SidebarMenuButton: "button",
  SidebarMenuItem: "li",
  SidebarTrigger: "button",
  useSidebar: () => ({ isMobile: false, setOpenMobile: () => undefined }),
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({
    render,
    children = render.props.children,
  }: {
    render: ReactElement<{ children?: ReactNode }>;
    children?: ReactNode;
  }) => cloneElement(render, undefined, children),
  TooltipPopup: () => null,
}));
vi.mock("./SidebarUpdatePill", () => ({
  SidebarUpdatePill: () => null,
  SidebarUpdateArchitectureWarning: () => null,
}));

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
} from "../../hooks/useSettings";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { environmentSummaries } from "../../state/presentation";
import { environmentProjects } from "../../state/projects";
import { environmentServerConfigsAtom } from "../../state/server";
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

let renderer: ReactTestRenderer | undefined;

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

async function mount(
  projects: EnvironmentProject[],
  configs = [config(local), config(remote)],
  snapshotsReady = true,
) {
  state.registry = AtomRegistry.make({
    initialValues: [
      [environmentProjects.projectsAtom, projects],
      [primaryEnvironmentIdAtom, local],
      [environmentSummaries.pullRequestsSupportedAtom, true],
      [allEnvironmentProjectSnapshotsReadyAtom, snapshotsReady],
      [
        environmentServerConfigsAtom,
        new Map(configs.map((value) => [value.environment.environmentId, value])),
      ],
    ],
  });
  const root = createRootRoute({ component: SidebarUtilityMenu });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/" }),
      createRoute({ getParentRoute: () => root, path: "/pull-requests" }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  await act(() => {
    renderer = create(
      <RegistryContext.Provider value={state.registry!}>
        <RouterProvider router={router} />
      </RegistryContext.Provider>,
    );
  });
  return router;
}

async function openPullRequests() {
  await act(async () => {
    pullRequestsButton().props.onClick();
  });
}

function pullRequestsButton() {
  return renderer!.root.find(
    (node) => node.type === "button" && node.props["aria-label"] === "Pull Requests",
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  useUiStateStore.setState({ sidebarProjectScopeKey: null });
  writePullRequestListPreferences(savedPreferences);
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  state.registry?.dispose();
  useUiStateStore.setState({ sidebarProjectScopeKey: null });
  __resetClientSettingsPersistenceForTests();
  vi.unstubAllGlobals();
});

describe("opening pull requests from the sidebar", () => {
  it("uses the current sidebar project and its environment instead of the saved scope", async () => {
    const current = project("current-project", remote);
    useUiStateStore.getState().setSidebarProjectScopeKey(`${remote}:${current.workspaceRoot}`);
    const router = await mount([project("current-project"), current]);

    await openPullRequests();

    expect(router.state.location.pathname).toBe("/pull-requests");
    expect(router.state.location.search).toEqual({
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
      useUiStateStore.getState().setSidebarProjectScopeKey(scopeKey);
      const router = await mount([project("current-project")]);

      await openPullRequests();

      expect(router.state.location.search).toEqual({
        involvement: "reviewing",
        state: "closed",
        sort: "updated",
      });
    },
  );

  it("reads the current scope again on every opening", async () => {
    const first = project("first-project");
    const second = project("second-project", remote);
    const router = await mount([first, second]);
    await act(() => {
      useUiStateStore.getState().setSidebarProjectScopeKey(`${local}:${first.workspaceRoot}`);
    });
    await openPullRequests();
    expect(router.state.location.search).toMatchObject({
      projectId: first.id,
      environmentId: local,
    });

    await act(() => router.navigate({ to: "/" }));
    writePullRequestListPreferences({ ...savedPreferences, projectId: first.id });
    await act(() => {
      useUiStateStore.getState().setSidebarProjectScopeKey(`${remote}:${second.workspaceRoot}`);
    });
    await openPullRequests();
    expect(router.state.location.search).toMatchObject({
      projectId: second.id,
      environmentId: remote,
    });

    await act(() => router.navigate({ to: "/" }));
    await act(() => {
      useUiStateStore.getState().setSidebarProjectScopeKey(null);
    });
    await openPullRequests();
    expect(router.state.location.search).not.toHaveProperty("projectId");
    expect(router.state.location.search).not.toHaveProperty("environmentId");
  });

  it("keeps an unresolved scope while snapshots load and opens it when its project arrives", async () => {
    const current = project("current-project", remote);
    const scopeKey = `${remote}:${current.workspaceRoot}`;
    useUiStateStore.getState().setSidebarProjectScopeKey(scopeKey);
    const router = await mount([project("other-project")], undefined, false);

    expect(pullRequestsButton().props.disabled).toBe(true);
    await openPullRequests();

    expect(router.state.location.pathname).toBe("/");
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe(scopeKey);
    expect(readPullRequestListPreferences()).toEqual(savedPreferences);

    await act(() => {
      state.registry!.set(state.projectsAtom!, [current]);
    });
    expect(state.registry!.get(allEnvironmentProjectSnapshotsReadyAtom)).toBe(false);
    expect(pullRequestsButton().props.disabled).toBe(false);
    expect(router.state.location.pathname).toBe("/");
    await openPullRequests();

    expect(router.state.location.pathname).toBe("/pull-requests");
    expect(router.state.location.search).toEqual({
      involvement: "reviewing",
      state: "closed",
      sort: "updated",
      environmentId: remote,
      projectId: current.id,
    });
  });

  it("opens All projects for a missing scope only after live snapshots establish its absence", async () => {
    useUiStateStore.getState().setSidebarProjectScopeKey("missing-project");
    const router = await mount([], undefined, false);

    expect(pullRequestsButton().props.disabled).toBe(true);
    await openPullRequests();
    expect(router.state.location.pathname).toBe("/");
    expect(readPullRequestListPreferences()).toEqual(savedPreferences);

    await act(() => {
      state.registry!.set(state.snapshotsReadyAtom!, true);
    });
    expect(pullRequestsButton().props.disabled).toBe(false);
    expect(router.state.location.pathname).toBe("/");
    await openPullRequests();

    expect(router.state.location.pathname).toBe("/pull-requests");
    expect(router.state.location.search).toEqual({
      involvement: "reviewing",
      state: "closed",
      sort: "updated",
    });
  });

  it("allows switching to All projects while snapshots are still loading", async () => {
    useUiStateStore.getState().setSidebarProjectScopeKey("unloaded-project");
    const router = await mount([], undefined, false);

    expect(pullRequestsButton().props.disabled).toBe(true);
    await act(() => {
      useUiStateStore.getState().setSidebarProjectScopeKey(null);
    });
    expect(pullRequestsButton().props.disabled).toBe(false);
    await openPullRequests();

    expect(router.state.location.pathname).toBe("/pull-requests");
    expect(router.state.location.search).toEqual({
      involvement: "reviewing",
      state: "closed",
      sort: "updated",
    });
  });

  it.each(["unsupported", "connecting"] as const)(
    "preserves a selected project while its server is %s, then opens it once capable",
    async (serverState) => {
      const current = project("shared-project-id", remote);
      const scopeKey = `${remote}:${current.workspaceRoot}`;
      useUiStateStore.getState().setSidebarProjectScopeKey(scopeKey);
      const configs =
        serverState === "unsupported" ? [config(local), config(remote, false)] : [config(local)];
      const router = await mount([project("shared-project-id"), current], configs);

      expect(pullRequestsButton().props.disabled).toBe(true);
      await openPullRequests();
      expect(router.state.location.pathname).toBe("/");
      expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe(scopeKey);
      expect(readPullRequestListPreferences()).toEqual(savedPreferences);

      await act(() => {
        useUiStateStore.getState().setSidebarProjectScopeKey(null);
      });
      expect(pullRequestsButton().props.disabled).toBe(false);
      await openPullRequests();
      expect(router.state.location.pathname).toBe("/pull-requests");
      expect(router.state.location.search).toEqual({
        involvement: "reviewing",
        state: "closed",
        sort: "updated",
      });

      await act(() => router.navigate({ to: "/" }));
      await act(() => {
        useUiStateStore.getState().setSidebarProjectScopeKey(scopeKey);
      });
      expect(pullRequestsButton().props.disabled).toBe(true);
      await act(() => {
        state.registry!.set(
          state.serverConfigsAtom!,
          new Map([
            [local, config(local)],
            [remote, config(remote)],
          ]),
        );
      });
      expect(pullRequestsButton().props.disabled).toBe(false);
      expect(router.state.location.pathname).toBe("/");
      await openPullRequests();

      expect(router.state.location.pathname).toBe("/pull-requests");
      expect(router.state.location.search).toEqual({
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
      const router = await mount(projects, [config(local, localSupported), config(remote)]);

      await openPullRequests();

      expect(router.state.location.search).toMatchObject({
        projectId,
        environmentId,
      });
    },
  );

  it("ignores a hidden project scope in legacy mode while snapshots are loading", async () => {
    __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, legacySidebarEnabled: true });
    const current = project("current-project");
    useUiStateStore.getState().setSidebarProjectScopeKey(`${local}:${current.workspaceRoot}`);
    const router = await mount([], undefined, false);

    expect(pullRequestsButton().props.disabled).toBe(false);
    await openPullRequests();

    expect(router.state.location.pathname).toBe("/pull-requests");
    expect(router.state.location.search).toEqual({
      involvement: "reviewing",
      state: "closed",
      sort: "updated",
    });
  });
});
