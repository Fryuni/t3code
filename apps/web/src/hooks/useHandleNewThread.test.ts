import { describe, expect, it, vi } from "vite-plus/test";
import type { RuntimeMode } from "@t3tools/contracts";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let targetSettings = {
    defaultThreadEnvMode: "local" as "local" | "worktree",
    newWorktreesStartFromOrigin: false,
    defaultModelSelection: null,
    defaultRuntimeMode: "full-access" as RuntimeMode,
    projectSettingsOverrides: {} as Record<string, { defaultThreadBaseBranch?: string }>,
  };
  let storedDraft: {
    readonly draftId: string;
    readonly environmentId: string;
    readonly promotedTo: null;
    readonly threadId: string;
    readonly environmentSelection?: "auto" | "manual";
  } | null = null;
  const router = {
    state: {
      location: { href: "/" },
      matches: [{ params: {} }],
    },
    navigate: vi.fn(async (request: { readonly params: { readonly draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
    }),
  };
  const draftStore = {
    getComposerDraft: vi.fn(() => ({})),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn(() => null),
    getDraftThread: vi.fn(() => null),
    applyStickyState: vi.fn(),
    setDraftThreadContext: vi.fn(),
    setLogicalProjectDraftThreadId: vi.fn(),
    setModelSelection: vi.fn(),
  };

  return {
    completeProjectFileRead: (value: null) => completeProjectFileRead(value),
    draftStore,
    get projectFileRead() {
      return projectFileRead;
    },
    get targetSettings() {
      return targetSettings;
    },
    reset(
      nextStoredDraft: typeof storedDraft,
      workspaceDefaults = {
        envMode: "local" as "local" | "worktree",
        startFromOrigin: false,
      },
    ) {
      storedDraft = nextStoredDraft;
      targetSettings = {
        defaultThreadEnvMode: workspaceDefaults.envMode,
        newWorktreesStartFromOrigin: workspaceDefaults.startFromOrigin,
        defaultModelSelection: null,
        defaultRuntimeMode: "full-access",
        projectSettingsOverrides: {},
      };
      router.state.location.href = "/";
      router.navigate.mockClear();
      draftStore.setDraftThreadContext.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    router,
  };
});

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "primary-settings"
      ? { newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin }
      : new Map([
          [
            "environment-primary",
            {
              settings: {
                ...testState.targetSettings,
                newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin,
              },
            },
          ],
          ["environment-ssh", { settings: testState.targetSettings }],
        ]),
}));
vi.mock("@t3tools/client-runtime/environment", () => ({
  scopedProjectKey: () => "remote-project",
  scopeProjectRef: (environmentId: string, projectId: string) => ({ environmentId, projectId }),
  scopeThreadRef: (environmentId: string, threadId: string) => ({ environmentId, threadId }),
}));
vi.mock("@t3tools/contracts", () => ({
  DEFAULT_RUNTIME_MODE: "default",
  DEFAULT_SERVER_SETTINGS: {},
}));
vi.mock("@t3tools/shared/projectSettings", () => ({
  // Environment settings pass through; the tests set project fields on the
  // project record, which the hook still honors until the server folds them.
  // With a file argument the env mode resolves like the real chain.
  resolveProjectSettings: (
    settings: Record<string, unknown>,
    projectId: string | null,
    _project: unknown,
    projectFile?: { defaultThreadEnvMode?: "local" | "worktree" } | null,
  ) => ({
    settings:
      projectFile === undefined
        ? settings
        : {
            ...settings,
            defaultThreadEnvMode:
              settings.defaultThreadEnvMode ?? projectFile?.defaultThreadEnvMode ?? "local",
          },
    sources: { defaultModelSelection: "environment", defaultThreadEnvMode: "environment" },
    overrides:
      (settings as typeof testState.targetSettings).projectSettingsOverrides[projectId ?? ""] ?? {},
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: () => testState.router,
}));
vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
}));
vi.mock("../components/Sidebar.logic", () => ({ orderItemsByPreferredIds: () => [] }));
vi.mock("../composerDraftStore", () => {
  const useComposerDraftStore = Object.assign(() => null, {
    getState: () => testState.draftStore,
  });
  return {
    composerDraftHasUserContent: () => false,
    markPromotedDraftThreadByRef: vi.fn(),
    useComposerDraftStore,
  };
});
vi.mock("../lib/chatThreadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chatThreadActions")>()),
  hasExplicitComposerModelSelection: () => false,
  resolveNewThreadModelSelectionOverride: () => null,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: () => testState.projectFileRead,
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => "draft-delayed",
  newThreadId: () => "thread-delayed",
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "remote-project",
  getProjectOrderKey: () => "remote-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => ({
  readProjects: () => [
    {
      id: "project-remote",
      environmentId: "environment-ssh",
      workspaceRoot: "/remote/project",
      defaultThreadEnvMode: null,
      defaultModelSelection: null,
    },
  ],
  readThreadShell: () => null,
  useProjects: () => [],
  useThread: () => null,
}));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
  primaryServerSettingsAtom: "primary-settings",
}));
vi.mock("../threadRoutes", () => ({ resolveThreadRouteTarget: () => null }));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

import { useNewThreadHandler } from "./useHandleNewThread";

describe.each([
  ["new", null],
  [
    "reusable",
    {
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    },
  ],
])("useNewThreadHandler with a %s draft", (_, draft) => {
  it.each(["approval-required", "auto-accept-edits", "auto", "full-access"] as const)(
    "uses the target environment's %s permissions for new threads",
    async (runtimeMode) => {
      testState.reset(draft);
      testState.targetSettings.defaultRuntimeMode = runtimeMode;
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = useNewThreadHandler()(projectRef);
      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ runtimeMode }),
      );
    },
  );

  it("abandons a delayed draft open when the user navigates elsewhere", async () => {
    testState.reset(draft);
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.router.state.location.href = "/usage";
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "uses the target environment's start-from-origin default of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = openThread(projectRef);

      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(opened).toEqual({
        draftId: draft?.draftId ?? "draft-delayed",
        threadId: draft?.threadId ?? "thread-delayed",
      });
      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
      if (draft) {
        expect(testState.draftStore.setDraftThreadContext).toHaveBeenCalledWith(
          draft.draftId,
          expect.objectContaining({ envMode: "worktree", startFromOrigin }),
        );
      }
    },
  );

  it.each([true, false])(
    "preserves an explicit start-from-origin choice of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin: !startFromOrigin });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;

      const opened = await openThread(projectRef, { envMode: "worktree", startFromOrigin });

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
    },
  );

  // A reused draft may still hold an earlier existing-branch choice.
  it.each([
    { option: undefined, createNewBranch: true },
    { option: false, createNewBranch: false },
  ])(
    "opens with createNewBranch $createNewBranch when the option is $option",
    async ({ option, createNewBranch }) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin: false });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = openThread(
        projectRef,
        option === undefined ? undefined : { createNewBranch: option },
      );

      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ createNewBranch }),
      );
      if (draft) {
        expect(testState.draftStore.setDraftThreadContext).toHaveBeenCalledWith(
          draft.draftId,
          expect.objectContaining({ createNewBranch }),
        );
      }
    },
  );

  it.each([
    {
      case: "starts a worktree draft from",
      envMode: "worktree",
      options: undefined,
      branch: "dev",
    },
    { case: "leaves a local draft without", envMode: "local", options: undefined, branch: null },
    {
      case: "lets an explicit branch win over",
      envMode: "worktree",
      options: { envMode: "worktree", branch: "release" },
      branch: "release",
    },
  ] as const)("$case the project's default base branch", async ({ envMode, options, branch }) => {
    testState.reset(draft, { envMode, startFromOrigin: false });
    testState.targetSettings.projectSettingsOverrides = {
      "project-remote": { defaultThreadBaseBranch: "dev" },
    };
    const projectRef = {
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never;
    const pendingOpen = useNewThreadHandler()(projectRef, options);
    testState.completeProjectFileRead(null);
    const opened = await pendingOpen;

    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      projectRef,
      opened!.draftId,
      expect.objectContaining({ envMode, branch }),
    );
  });

  // The draft store reads a bare branch as a manual pick, which turns off load balancing.
  it("keeps a draft seeded with the project's default base branch automatically placed", async () => {
    testState.reset(draft, { envMode: "worktree", startFromOrigin: false });
    testState.targetSettings.projectSettingsOverrides = {
      "project-remote": { defaultThreadBaseBranch: "dev" },
    };
    const projectRef = {
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never;
    const pendingOpen = useNewThreadHandler()(projectRef);
    testState.completeProjectFileRead(null);
    const opened = await pendingOpen;

    const seeded = expect.objectContaining({ branch: "dev", environmentSelection: "auto" });
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      projectRef,
      opened!.draftId,
      seeded,
    );
    if (draft) {
      expect(testState.draftStore.setDraftThreadContext).toHaveBeenCalledWith(
        draft.draftId,
        seeded,
      );
    }
  });

  it("does not offer the project's default base branch as an existing branch to check out", async () => {
    testState.reset(draft, { envMode: "worktree", startFromOrigin: false });
    testState.targetSettings.projectSettingsOverrides = {
      "project-remote": { defaultThreadBaseBranch: "dev" },
    };
    const projectRef = {
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never;
    const pendingOpen = useNewThreadHandler()(projectRef, { createNewBranch: false });
    testState.completeProjectFileRead(null);
    const opened = await pendingOpen;

    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      projectRef,
      opened!.draftId,
      expect.not.objectContaining({ branch: "dev" }),
    );
  });
});

// Seeding fills in the branch only; a machine the user pinned for the draft stays pinned.
it("keeps a reused draft's manual environment when seeding the project's default base branch", async () => {
  testState.reset(
    {
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
      environmentSelection: "manual",
    },
    { envMode: "worktree", startFromOrigin: false },
  );
  testState.targetSettings.projectSettingsOverrides = {
    "project-remote": { defaultThreadBaseBranch: "dev" },
  };
  const pendingOpen = useNewThreadHandler()({
    environmentId: "environment-ssh",
    projectId: "project-remote",
  } as never);
  testState.completeProjectFileRead(null);
  await pendingOpen;

  expect(testState.draftStore.setDraftThreadContext).toHaveBeenCalledWith(
    "draft-existing",
    expect.objectContaining({ branch: "dev", environmentSelection: "manual" }),
  );
});
