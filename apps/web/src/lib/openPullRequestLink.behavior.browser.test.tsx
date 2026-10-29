import { RegistryContext } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  SourceControlProviderKind,
  ThreadId,
  type ServerConfig,
} from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { AtomRegistry } from "effect/reactivity";
import { useLayoutEffect, type MouseEvent } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";

// Supply the same isolated registry to imperative reads and React subscriptions.
// Routing, repository matching, the panel store, and link opening remain real.
// Browser mocks snapshot their exports, so the registry is reached through a proxy.
const state = vi.hoisted(() => ({
  registry: undefined as AtomRegistry.AtomRegistry | undefined,
  projects: [] as ReadonlyArray<EnvironmentProject>,
}));
vi.mock(import("../rpc/atomRegistry"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    appAtomRegistry: new Proxy({} as AtomRegistry.AtomRegistry, {
      get: (_, key) => {
        // Theme setup reads the registry on import, before a test supplies one.
        const registry = state.registry ?? actual.appAtomRegistry;
        const value = Reflect.get(registry, key);
        return typeof value === "function" ? value.bind(registry) : value;
      },
    }),
  };
});
// The primary environment, server configs, and project list derive from the connection
// catalog, whose load can land mid-test and replace a seeded value. The tests seed plain atoms
// instead, and stub the opener's click-time project read.
vi.mock(import("../state/primaryEnvironment"), async () => {
  const { Atom } = await import("effect/reactivity");
  return { primaryEnvironmentIdAtom: Atom.make<EnvironmentId | null>(null) };
});
vi.mock(import("../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  return {
    ...(await original()),
    environmentServerConfigsAtom: Atom.make<ReadonlyMap<EnvironmentId, ServerConfig>>(new Map()),
  };
});
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  readProjects: () => state.projects,
}));

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
} from "../hooks/useSettings";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { environmentServerConfigsAtom } from "../state/server";
import { environmentThreadShells } from "../state/threads";
import { makeThreadFixture } from "../test-fixtures";
import type { Thread } from "../types";
import { useOpenPrLink } from "./openPullRequestLink";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const threadRef = scopeThreadRef(remote, ThreadId.make("thread"));
const date = "2026-09-21T00:00:00.000Z";
const providers = [
  {
    provider: "github",
    repository: "acme/repo",
    origin: "https://github.com",
    path: "acme/repo/pull/42",
  },
  {
    provider: "github",
    repository: "acme/repo",
    origin: "https://github.acme.test",
    path: "acme/repo/pull/42",
  },
  {
    provider: "gitlab",
    repository: "acme/group/repo",
    origin: "https://gitlab.com",
    path: "acme/group/repo/-/merge_requests/42",
  },
  {
    provider: "forgejo",
    repository: "Forge/acme/repo",
    origin: "http://forge.test:3000",
    path: "Forge/acme/repo/pulls/42",
  },
  {
    provider: "bitbucket",
    repository: "acme/repo",
    origin: "https://bitbucket.org",
    path: "acme/repo/pull-requests/42",
  },
  {
    provider: "azure-devops",
    repository: "acme/project/_git/repo",
    origin: "https://dev.azure.com",
    path: "acme/project/_git/repo/pullrequest/42",
  },
];
const github = providers[0]!;

function project(id: string, environmentId = remote, source = github): EnvironmentProject {
  return {
    id: ProjectId.make(id),
    environmentId,
    title: id,
    workspaceRoot: `/checkouts/${id}`,
    defaultModelSelection: null,
    scripts: [],
    createdAt: date,
    updatedAt: date,
    repositoryIdentity: {
      provider: SourceControlProviderKind.make(source.provider),
      canonicalKey: `${new URL(source.origin).host}/${source.repository}`,
      displayName: source.repository,
      webUrl: `${source.origin}/${source.repository}`,
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: `${source.origin}/${source.repository}.git`,
      },
    },
  };
}

function thread(checkout: EnvironmentProject): Thread {
  return makeThreadFixture({
    id: threadRef.threadId,
    environmentId: threadRef.environmentId,
    projectId: checkout.id,
    branch: "feature",
  });
}

function config(environmentId: EnvironmentId): ServerConfig {
  return {
    environment: {
      environmentId,
      label: environmentId,
      platform: { os: "linux", arch: "x64" },
      serverVersion: "test",
      capabilities: { repositoryIdentity: true, pullRequests: true, threadPullRequests: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "test",
    },
    cwd: "/checkouts",
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

function click() {
  return {
    metaKey: false,
    ctrlKey: false,
    currentTarget: {},
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as MouseEvent<HTMLElement>;
}

function setup(): Disposable {
  state.projects = [];
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  return { [Symbol.dispose]: () => __resetClientSettingsPersistenceForTests() };
}

async function mount({
  projects,
  currentThread,
  bindThread = true,
  configs = [config(local), config(remote)],
}: {
  projects: EnvironmentProject[];
  currentThread: Thread;
  bindThread?: boolean;
  configs?: ServerConfig[];
}) {
  await using stack = new AsyncDisposableStack();
  const ref = scopeThreadRef(currentThread.environmentId, currentThread.id);
  state.projects = projects;
  const registry = AtomRegistry.make({
    initialValues: [
      [
        environmentServerConfigsAtom,
        new Map(configs.map((value) => [value.environment.environmentId, value])),
      ],
      [primaryEnvironmentIdAtom, local],
      [environmentThreadShells.threadShellAtom(ref), currentThread],
    ],
  });
  state.registry = registry;
  stack.defer(() => registry.dispose());
  registry.mount(environmentThreadShells.threadShellAtom(ref));
  // Links read server configs at click time, so keep the seeded value mounted.
  registry.mount(environmentServerConfigsAtom);
  const probe: { openPr?: ReturnType<typeof useOpenPrLink> } = {};
  function Probe() {
    const pr = useOpenPrLink(bindThread ? ref : undefined);
    useLayoutEffect(() => {
      probe.openPr = pr;
    });
    return null;
  }
  const rootRoute = createRootRoute({ component: Probe });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: "/pull-requests" }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/pull-requests"] }),
  });
  await router.load();
  stack.use(
    // router: false because the probe needs a /pull-requests route the test router lacks.
    await render(
      <RegistryContext.Provider value={registry}>
        <RouterProvider router={router} />
      </RegistryContext.Provider>,
      { router: false },
    ),
  );
  const owned = stack.move();
  return {
    router,
    openPr: (...args: Parameters<ReturnType<typeof useOpenPrLink>>) => probe.openPr!(...args),
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}

const activePanel = () =>
  selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef);

describe("thread checkout preference", () => {
  it.each(providers)(
    "opens $provider ($origin) beside the thread's own checkout",
    async (source) => {
      using _setup = setup();
      const other = project("other", remote, source);
      const own = project("own", remote, source);
      await using mounted = await mount({ projects: [other, own], currentThread: thread(own) });
      const url = `${source.origin}/${source.path}`;
      const event = click();
      expect(mounted.openPr(event, url)).toBe(true);
      expect(activePanel()).toMatchObject({
        kind: "pull-request",
        projectId: "own",
        repository: source.repository,
        number: 42,
        url,
      });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mounted.router.state.location.search).toEqual({});
    },
  );

  it("uses the explicit target thread's checkout for sidebar links", async () => {
    using _setup = setup();
    const own = project("own");
    await using mounted = await mount({
      projects: [project("foreign", local), project("other"), own],
      currentThread: thread(own),
      bindThread: false,
    });
    expect(mounted.openPr(click(), `${github.origin}/${github.path}`, threadRef)).toBe(true);
    expect(activePanel()).toMatchObject({ projectId: "own" });
    expect(activePanel()).not.toHaveProperty("environmentId");
  });

  it("does not let a duplicate project id in the primary environment capture a thread link", async () => {
    using _setup = setup();
    const own = project("same-id");
    await using mounted = await mount({
      projects: [project("same-id", local), own],
      currentThread: thread(own),
    });
    expect(mounted.openPr(click(), `${github.origin}/${github.path}`)).toBe(true);
    expect(activePanel()).toMatchObject({ projectId: "same-id" });
    expect(activePanel()).not.toHaveProperty("environmentId");
  });

  it("uses a matching checkout in the thread environment when its own project is unrelated", async () => {
    using _setup = setup();
    const own = project("own", remote, { ...github, repository: "acme/other" });
    await using mounted = await mount({
      projects: [project("foreign", local), project("matching"), own],
      currentThread: thread(own),
    });
    expect(mounted.openPr(click(), `${github.origin}/${github.path}`)).toBe(true);
    expect(activePanel()).toMatchObject({ projectId: "matching" });
    expect(activePanel()).not.toHaveProperty("environmentId");
  });

  it("keeps a thread link external with a missing checkout instead of borrowing another environment", async () => {
    using _setup = setup();
    const own = project("own", remote, { ...github, origin: "https://elsewhere.test" });
    await using mounted = await mount({
      projects: [project("foreign", local), own],
      currentThread: thread(own),
    });
    const external = vi.fn();
    using _open = vi.spyOn(window, "open").mockImplementation(external);
    await act(async () => {
      expect(mounted.openPr(click(), `${github.origin}/${github.path}`)).toBe(false);
    });
    expect(activePanel()).toBeNull();
    expect(external).toHaveBeenCalledWith(
      `${github.origin}/${github.path}`,
      "_blank",
      "noopener,noreferrer",
    );
  });
});
