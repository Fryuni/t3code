import { EnvironmentId, ProjectId, ThreadId, type VcsRef } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  serverThread: null as {
    id: string;
    environmentId: string;
    projectId: string;
    branch: string | null;
    worktreePath: string | null;
    runtime: null;
  } | null,
  draftThread: null as {
    environmentId: string;
    projectId: string;
    branch: string | null;
    worktreePath: string | null;
    envMode: "worktree";
    environmentSelection: "auto";
  } | null,
  refs: [] as VcsRef[],
  updateMetadata: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn().mockResolvedValue(undefined),
  setDraftThreadContext: vi.fn(),
  setBranchOverride: vi.fn(),
}));

vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useQuietThreadShell: (() => state.serverThread) as never,
  useProject: (() => ({ id: "project", environmentId: "local", workspaceRoot: "/repo" })) as never,
  useServerConfigs: () => new Map(),
}));
vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock(import("../state/threads"), async (original) => ({
  ...(await original()),
  threadEnvironment: {
    updateMetadata: state.updateMetadata,
    stopSession: state.stopSession,
  } as never,
}));
vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: unknown) => command) as never,
}));
vi.mock(import("../state/vcs"), async (original) => ({
  ...(await original()),
  vcsEnvironment: { status: () => "status", listRefs: () => "refs" } as never,
}));
vi.mock(import("../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((query: string) => ({
    data: query === "status" ? { refName: "main" } : { refs: state.refs },
    refresh: vi.fn(),
  })) as never,
}));
vi.mock(import("../state/queries"), async (original) => ({
  ...(await original()),
  usePaginatedBranches: (() => ({
    refs: state.refs,
    data: { nextCursor: null },
    isPending: false,
  })) as never,
}));
vi.mock(import("../hooks/useSupportsMultiplePullRequests"), async (original) => ({
  ...(await original()),
  useSupportsMultiplePullRequests: () => false,
}));
vi.mock(import("../lib/openPullRequestLink"), async (original) => ({
  ...(await original()),
  useOpenPrLink: () => vi.fn(),
}));
vi.mock(import("./chat/composerEventScope"), async (original) => ({
  ...(await original()),
  useComposerMenuProps: (() => ({})) as never,
}));
vi.mock(import("./ThreadStatusIndicators"), async (original) => ({
  ...(await original()),
  useLinkedThreadPullRequest: () => null,
  prStatusIndicator: () => null,
  ThreadPullRequestBadgeControl: () => null,
}));
vi.mock(import("./BranchPicker"), async (original) => ({
  ...(await original()),
  BranchPicker: (() => null) as never,
  BranchPickerRefItem: (() => null) as never,
}));
vi.mock(import("./chat/ThreadDetailsControl"), async (original) => ({
  ...(await original()),
  ThreadDetailsControl: (() => null) as never,
}));
vi.mock(import("./chat/ThreadDetailsPrRows"), async (original) => ({
  ...(await original()),
  ThreadDetailsPrRows: (() => null) as never,
}));
vi.mock(import("./ui/combobox"), async (original) => ({
  ...(await original()),
  ComboboxItem: (() => null) as never,
  ComboboxTrigger: (() => null) as never,
}));
vi.mock(import("./ui/middle-truncate"), async (original) => ({
  ...(await original()),
  MiddleTruncate: (() => null) as never,
}));
vi.mock(import("./ui/toast"), async (original) => ({
  ...(await original()),
  stackedThreadToast: vi.fn(),
  toastManager: { add: vi.fn() } as never,
}));

import { useComposerDraftStore } from "../composerDraftStore";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("thread");
let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.serverThread = null;
  state.draftThread = null;
  state.refs = [{ name: "main", current: true, isDefault: true, worktreePath: "/repo" }];
  useComposerDraftStore.setState({
    getDraftThreadByRef: (() => state.draftThread) as never,
    setDraftThreadContext: state.setDraftThreadContext,
  });
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

async function render(options: { envLocked: boolean; createNewBranch?: boolean }) {
  await act(() => {
    const selector = (
      <BranchToolbarBranchSelector
        environmentId={environmentId}
        threadId={threadId}
        effectiveEnvModeOverride="worktree"
        envLocked={options.envLocked}
        onActiveThreadBranchOverrideChange={state.setBranchOverride}
        createNewBranch={options.createNewBranch ?? true}
        startFromRemote={null}
        onStartFromRemoteChange={vi.fn()}
      />
    );
    if (!root) {
      container = document.body.appendChild(document.createElement("div"));
      root = createRoot(container);
    }
    root.render(selector);
  });
}

it("does not reset a launched worktree from its initial unprovisioned shell", async () => {
  state.serverThread = {
    id: threadId,
    environmentId,
    projectId,
    branch: null,
    worktreePath: null,
    runtime: null,
  };

  await render({ envLocked: true });

  state.serverThread = {
    ...state.serverThread,
    branch: "t3/abcd1234",
    worktreePath: "/repo-worktrees/temp",
  };
  await render({ envLocked: true });

  expect(state.updateMetadata).not.toHaveBeenCalled();
  expect(state.stopSession).not.toHaveBeenCalled();
  expect(state.setBranchOverride).not.toHaveBeenCalled();
});

it("clears an unavailable existing branch in an empty thread's pending selection", async () => {
  state.serverThread = {
    id: threadId,
    environmentId,
    projectId,
    branch: "main",
    worktreePath: null,
    runtime: null,
  };

  await render({ envLocked: false, createNewBranch: false });

  expect(state.updateMetadata).not.toHaveBeenCalled();
  expect(state.stopSession).not.toHaveBeenCalled();
  expect(state.setBranchOverride).toHaveBeenCalledWith(null);
});

it("defaults an empty thread's pending worktree base without changing its workspace", async () => {
  state.serverThread = {
    id: threadId,
    environmentId,
    projectId,
    branch: null,
    worktreePath: null,
    runtime: null,
  };

  await render({ envLocked: false });

  expect(state.setBranchOverride).toHaveBeenCalledWith("main");
  expect(state.updateMetadata).not.toHaveBeenCalled();
  expect(state.stopSession).not.toHaveBeenCalled();
});

it("still defaults a new worktree draft to the repository's base branch", async () => {
  state.draftThread = {
    environmentId,
    projectId,
    branch: null,
    worktreePath: null,
    envMode: "worktree",
    environmentSelection: "auto",
  };

  await render({ envLocked: false });

  expect(state.setDraftThreadContext).toHaveBeenCalledWith(
    { environmentId, threadId },
    {
      branch: "main",
      worktreePath: null,
      envMode: "worktree",
      environmentSelection: "auto",
      projectRef: { environmentId, projectId },
    },
  );
  expect(state.updateMetadata).not.toHaveBeenCalled();
});

it("still clears an unavailable existing branch in a draft", async () => {
  state.draftThread = {
    environmentId,
    projectId,
    branch: "main",
    worktreePath: null,
    envMode: "worktree",
    environmentSelection: "auto",
  };

  await render({ envLocked: false, createNewBranch: false });

  expect(state.setDraftThreadContext).toHaveBeenCalledWith(
    { environmentId, threadId },
    {
      branch: null,
      worktreePath: null,
      envMode: "worktree",
      environmentSelection: "auto",
      projectRef: { environmentId, projectId },
    },
  );
  expect(state.updateMetadata).not.toHaveBeenCalled();
});
