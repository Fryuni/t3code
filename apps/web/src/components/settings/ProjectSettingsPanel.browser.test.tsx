import { RegistryContext } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type AuthEnvironmentScope,
  type AuthSessionState,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { AsyncResult, Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { Project } from "../../types";
import { render } from "../../../test/render";

type SessionResult = AsyncResult.AsyncResult<AuthSessionState, Error>;
const state = vi.hoisted(() => ({
  sessions: new Map<EnvironmentId, Atom.Writable<SessionResult>>(),
  environments: [] as Array<{
    environmentId: EnvironmentId;
    label: string;
    connection: { phase: string };
    serverConfig: unknown;
  }>,
  projects: [] as Project[],
  openAddProjectToMachine: vi.fn(),
}));

// Session grants come from the server; each test drives them through these atoms.
vi.mock(import("@t3tools/client-runtime/state/session"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    createEnvironmentSessionAtoms: ((
      ...args: Parameters<typeof actual.createEnvironmentSessionAtoms>
    ) => ({
      ...actual.createEnvironmentSessionAtoms(...args),
      sessionStateAtom: (id: EnvironmentId) => state.sessions.get(id)!,
    })) as typeof actual.createEnvironmentSessionAtoms,
  };
});
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: state.environments })) as never,
  usePrimaryEnvironmentId: () => primaryId,
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => state.projects) as never,
  useThreadShells: () => [],
}));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => vi.fn()) as never,
}));
vi.mock(import("~/hooks/useSettings"), async (original) => ({
  ...(await original()),
  useClientSettings: ((selector?: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    selector ? selector(DEFAULT_CLIENT_SETTINGS) : DEFAULT_CLIENT_SETTINGS) as never,
}));
// Sections with their own data sources and tests; this file covers project checkouts.
vi.mock(import("./ProjectDefaultsSettings"), async (original) => ({
  ...(await original()),
  ProjectDefaultsSettings: (() => null) as never,
}));
vi.mock(import("./ProjectActionsSettings"), async (original) => ({
  ...(await original()),
  ProjectActionsSettings: (() => null) as never,
}));
vi.mock(import("../AddProjectToMachineDialog"), () => ({
  openAddProjectToMachine: state.openAddProjectToMachine,
  AddProjectToMachineDialogHost: () => null,
}));

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import { ProjectSettingsPanel } from "./ProjectSettingsPanel";

const primaryId = EnvironmentId.make("primary");
const remoteId = EnvironmentId.make("remote");
const instanceId = ProviderInstanceId.make("codex");
const session = (scopes: ReadonlyArray<AuthEnvironmentScope>): AuthSessionState => ({
  authenticated: true,
  scopes,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["bearer-access-token"],
    sessionCookieName: "t3_session",
  },
});

function setup(input: {
  readonly checkouts: ReadonlyArray<EnvironmentId>;
  readonly remote?: { readonly phase?: string; readonly scopes?: AuthEnvironmentScope[] };
}) {
  state.openAddProjectToMachine.mockClear();
  state.environments = [primaryId, remoteId].map((environmentId) => ({
    environmentId,
    label: environmentId,
    connection: {
      phase: environmentId === remoteId ? (input.remote?.phase ?? "connected") : "connected",
    },
    serverConfig: {
      keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
      environment: {
        platform: { machine: "server" },
        capabilities: { projectCloneTracking: true },
      },
    },
  }));
  state.sessions.clear();
  for (const id of [primaryId, remoteId]) {
    const scopes =
      id === remoteId && input.remote?.scopes
        ? input.remote.scopes
        : [AuthOrchestrationOperateScope, AuthSourceControlWriteScope];
    state.sessions.set(
      id,
      Atom.make<SessionResult>(
        AsyncResult.success({ ...session(scopes), permissions: scopes }),
      ).pipe(Atom.keepAlive),
    );
  }
  state.projects = input.checkouts.map((environmentId) => ({
    id: ProjectId.make(`project-${environmentId}`),
    environmentId,
    title: "Shared repo",
    workspaceRoot: `/work/${environmentId}`,
    repositoryIdentity: {
      canonicalKey: "github.com/example/shared-repo",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/example/shared-repo.git",
      },
      rootPath: `/work/${environmentId}`,
    },
    defaultModelSelection: { instanceId, model: "gpt-5-codex" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  }));
}

async function mountPanel() {
  const projectKey = buildSidebarProjectSnapshots({
    projects: state.projects,
    settings: DEFAULT_CLIENT_SETTINGS,
    primaryEnvironmentId: primaryId,
    resolveEnvironmentLabel: (id) => id,
  })[0]!.projectKey;
  const screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <ProjectSettingsPanel projectKey={projectKey} />
    </RegistryContext.Provider>,
    { router: "/settings/projects" },
  );
  await vi.waitFor(() =>
    expect(screen.container.querySelector('[aria-label="Project name"]')).not.toBeNull(),
  );
  return screen;
}

const checkoutsHeading = (container: HTMLElement) =>
  [...container.querySelectorAll("h2")].find((heading) => heading.textContent === "Checkouts");
const addCheckout = (container: HTMLElement) =>
  [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Add checkout"),
  );

describe("project checkouts", () => {
  it("offers to check out a lone checkout on a connected machine without one", async () => {
    setup({ checkouts: [primaryId] });
    await using screen = await mountPanel();

    expect(checkoutsHeading(screen.container)).toBeDefined();
    await userEvent.click(addCheckout(screen.container)!);
    await page.getByRole("menuitem", { name: remoteId }).click();

    expect(state.openAddProjectToMachine).toHaveBeenCalledExactlyOnceWith({
      projectRef: { environmentId: primaryId, projectId: ProjectId.make("project-primary") },
      targetEnvironmentId: remoteId,
    });
  });

  it("leaves out a machine whose grant cannot clone the project", async () => {
    setup({ checkouts: [primaryId], remote: { scopes: [AuthOrchestrationOperateScope] } });
    await using screen = await mountPanel();
    expect(checkoutsHeading(screen.container)).toBeUndefined();
  });

  it("drops the add button once every connected machine has a checkout", async () => {
    setup({ checkouts: [primaryId, remoteId] });
    await using screen = await mountPanel();
    expect(checkoutsHeading(screen.container)).toBeDefined();
    expect(addCheckout(screen.container)).toBeUndefined();
  });

  it("hides checkouts when only one machine is connected", async () => {
    setup({ checkouts: [primaryId], remote: { phase: "disconnected" } });
    await using screen = await mountPanel();
    expect(checkoutsHeading(screen.container)).toBeUndefined();
  });
});
