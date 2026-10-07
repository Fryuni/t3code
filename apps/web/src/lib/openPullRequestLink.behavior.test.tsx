import { RegistryContext } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
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
import { act, useLayoutEffect, type MouseEvent } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Supply the same isolated registry to imperative reads and React subscriptions.
// Routing, repository matching, the panel store, and link opening remain real.
const state = vi.hoisted(() => ({ registry: undefined as AtomRegistry.AtomRegistry | undefined }));
vi.mock("../rpc/atomRegistry", () => ({
  get appAtomRegistry() {
    return state.registry;
  },
}));

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
} from "../hooks/useSettings";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { environmentProjects } from "../state/projects";
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
      provider: source.provider,
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

// useOpenPrLink tells anchors from buttons with `instanceof HTMLAnchorElement`.
class Anchor {
  constructor(readonly href: string) {}
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

let renderer: ReactTestRenderer | undefined;
let openPr: ReturnType<typeof useOpenPrLink>;
const external = vi.fn();

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
  const ref = scopeThreadRef(currentThread.environmentId, currentThread.id);
  state.registry = AtomRegistry.make({
    initialValues: [
      [environmentProjects.projectsAtom, projects],
      [
        environmentServerConfigsAtom,
        new Map(configs.map((value) => [value.environment.environmentId, value])),
      ],
      [primaryEnvironmentIdAtom, local],
      [environmentThreadShells.threadShellAtom(ref), currentThread],
    ],
  });
  state.registry.mount(environmentThreadShells.threadShellAtom(ref));
  function Probe() {
    const pr = useOpenPrLink(bindThread ? ref : undefined);
    useLayoutEffect(() => {
      openPr = pr;
    });
    return null;
  }
  const root = createRootRoute({ component: Probe });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/pull-requests" }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/pull-requests"] }),
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

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("HTMLAnchorElement", Anchor);
  external.mockReset();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  state.registry?.dispose();
  __resetClientSettingsPersistenceForTests();
  vi.unstubAllGlobals();
});

const activePanel = () =>
  selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef);

describe("thread checkout preference", () => {
  it.each(providers)(
    "opens $provider ($origin) beside the thread's own checkout",
    async (source) => {
      const other = project("other", remote, source);
      const own = project("own", remote, source);
      const router = await mount({ projects: [other, own], currentThread: thread(own) });
      const url = `${source.origin}/${source.path}`;
      const event = click();
      expect(openPr(event, url)).toBe(true);
      expect(activePanel()).toMatchObject({
        kind: "pull-request",
        projectId: "own",
        repository: source.repository,
        number: 42,
        url,
      });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(router.state.location.search).toEqual({});
    },
  );

  it("uses the explicit target thread's checkout for sidebar links", async () => {
    const own = project("own");
    await mount({
      projects: [project("foreign", local), project("other"), own],
      currentThread: thread(own),
      bindThread: false,
    });
    expect(openPr(click(), `${github.origin}/${github.path}`, threadRef)).toBe(true);
    expect(activePanel()).toMatchObject({ projectId: "own" });
    expect(activePanel()).not.toHaveProperty("environmentId");
  });

  it("does not let a duplicate project id in the primary environment capture a thread link", async () => {
    const own = project("same-id");
    await mount({ projects: [project("same-id", local), own], currentThread: thread(own) });
    expect(openPr(click(), `${github.origin}/${github.path}`)).toBe(true);
    expect(activePanel()).toMatchObject({ projectId: "same-id" });
    expect(activePanel()).not.toHaveProperty("environmentId");
  });

  it("uses a matching checkout in the thread environment when its own project is unrelated", async () => {
    const own = project("own", remote, { ...github, repository: "acme/other" });
    await mount({
      projects: [project("foreign", local), project("matching"), own],
      currentThread: thread(own),
    });
    expect(openPr(click(), `${github.origin}/${github.path}`)).toBe(true);
    expect(activePanel()).toMatchObject({ projectId: "matching" });
    expect(activePanel()).not.toHaveProperty("environmentId");
  });

  it.each(["missing checkout", "unsupported server"])(
    "keeps a thread link external with a %s instead of borrowing another environment",
    async (reason) => {
      const own = project(
        "own",
        remote,
        reason === "missing checkout" ? { ...github, origin: "https://elsewhere.test" } : github,
      );
      await mount({
        projects: [project("foreign", local), own],
        currentThread: thread(own),
        configs: [config(local), config(remote, reason !== "unsupported server")],
      });
      vi.stubGlobal("window", { open: external });
      await act(async () => {
        expect(openPr(click(), `${github.origin}/${github.path}`)).toBe(false);
      });
      expect(activePanel()).toBeNull();
      expect(external).toHaveBeenCalledWith(
        `${github.origin}/${github.path}`,
        "_blank",
        "noopener,noreferrer",
      );
    },
  );
});
