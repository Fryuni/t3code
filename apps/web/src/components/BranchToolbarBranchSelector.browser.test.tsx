import { EnvironmentId, ProjectId, ThreadId, type VcsRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";

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

function resetState() {
  vi.clearAllMocks();
  state.serverThread = null;
  state.draftThread = null;
  state.refs = [{ name: "main", current: true, isDefault: true, worktreePath: "/repo" }];
  useComposerDraftStore.setState({
    getDraftThreadByRef: (() => state.draftThread) as never,
    setDraftThreadContext: state.setDraftThreadContext,
  });
}

function selector(options: { envLocked: boolean; createNewBranch?: boolean }) {
  return (
    <BranchToolbarBranchSelector
      environmentId={environmentId}
      threadId={threadId}
      effectiveEnvModeOverride="worktree"
      envLocked={options.envLocked}
      onActiveThreadBranchOverrideChange={state.setBranchOverride}
      createNewBranch={options.createNewBranch ?? true}
      startFromOrigin={false}
      onStartFromOriginChange={vi.fn()}
    />
  );
}

it("does not reset a launched worktree from its initial unprovisioned shell", async () => {
  resetState();
  state.serverThread = {
    id: threadId,
    environmentId,
    projectId,
    branch: null,
    worktreePath: null,
    runtime: null,
  };

  await using screen = await render(selector({ envLocked: true }));

  state.serverThread = {
    ...state.serverThread,
    branch: "t3/abcd1234",
    worktreePath: "/repo-worktrees/temp",
  };
  await screen.rerender(selector({ envLocked: true }));

  expect(state.updateMetadata).not.toHaveBeenCalled();
  expect(state.stopSession).not.toHaveBeenCalled();
  expect(state.setBranchOverride).not.toHaveBeenCalled();
});

it("clears an unavailable existing branch in an empty thread's pending selection", async () => {
  resetState();
  state.serverThread = {
    id: threadId,
    environmentId,
    projectId,
    branch: "main",
    worktreePath: null,
    runtime: null,
  };

  await using _screen = await render(selector({ envLocked: false, createNewBranch: false }));

  expect(state.updateMetadata).not.toHaveBeenCalled();
  expect(state.stopSession).not.toHaveBeenCalled();
  expect(state.setBranchOverride).toHaveBeenCalledWith(null);
});

it("defaults an empty thread's pending worktree base without changing its workspace", async () => {
  resetState();
  state.serverThread = {
    id: threadId,
    environmentId,
    projectId,
    branch: null,
    worktreePath: null,
    runtime: null,
  };

  await using _screen = await render(selector({ envLocked: false }));

  expect(state.setBranchOverride).toHaveBeenCalledWith("main");
  expect(state.updateMetadata).not.toHaveBeenCalled();
  expect(state.stopSession).not.toHaveBeenCalled();
});

it("still defaults a new worktree draft to the repository's base branch", async () => {
  resetState();
  state.draftThread = {
    environmentId,
    projectId,
    branch: null,
    worktreePath: null,
    envMode: "worktree",
    environmentSelection: "auto",
  };

  await using _screen = await render(selector({ envLocked: false }));

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
  resetState();
  state.draftThread = {
    environmentId,
    projectId,
    branch: "main",
    worktreePath: null,
    envMode: "worktree",
    environmentSelection: "auto",
  };

  await using _screen = await render(selector({ envLocked: false, createNewBranch: false }));

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
