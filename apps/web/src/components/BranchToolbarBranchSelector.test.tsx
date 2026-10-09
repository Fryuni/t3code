import { EnvironmentId, ProjectId, ThreadId, type VcsRef } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
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
}));

vi.mock("../state/entities", () => ({
  useThreadShell: () => state.serverThread,
  useProject: () => ({ id: "project", environmentId: "local", workspaceRoot: "/repo" }),
  useServerConfigs: () => new Map(),
}));
vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: (select: (store: unknown) => unknown) =>
    select({
      getDraftThreadByRef: () => state.draftThread,
      setDraftThreadContext: state.setDraftThreadContext,
    }),
}));
vi.mock("../state/session", () => ({
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../state/threads", () => ({
  threadEnvironment: { updateMetadata: state.updateMetadata, stopSession: state.stopSession },
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../state/vcs", () => ({
  vcsEnvironment: { status: () => "status", listRefs: () => "refs" },
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (query: string) => ({
    data: query === "status" ? { refName: "main" } : { refs: state.refs },
    refresh: vi.fn(),
  }),
}));
vi.mock("../state/queries", () => ({
  usePaginatedBranches: () => ({ refs: state.refs, data: { nextCursor: null }, isPending: false }),
}));
vi.mock("../hooks/useSupportsMultiplePullRequests", () => ({
  useSupportsMultiplePullRequests: () => false,
}));
vi.mock("../lib/openPullRequestLink", () => ({ useOpenPrLink: () => vi.fn() }));
vi.mock("./chat/composerEventScope", () => ({ useComposerMenuProps: () => ({}) }));
vi.mock("./ThreadStatusIndicators", () => ({
  useLinkedThreadPullRequest: () => null,
  prStatusIndicator: () => null,
  ThreadPullRequestBadgeControl: () => null,
}));
vi.mock("./BranchPicker", () => ({ BranchPicker: () => null, BranchPickerRefItem: () => null }));
vi.mock("./chat/ThreadDetailsControl", () => ({ ThreadDetailsControl: () => null }));
vi.mock("./chat/ThreadDetailsPrRows", () => ({ ThreadDetailsPrRows: () => null }));
vi.mock("./chat/ComposerControl", () => ({ ComposerControl: () => null }));
vi.mock("./ui/combobox", () => ({ ComboboxItem: () => null, ComboboxTrigger: () => null }));
vi.mock("./ui/middle-truncate", () => ({ MiddleTruncate: () => null }));
vi.mock("./ui/toast", () => ({ stackedThreadToast: vi.fn(), toastManager: { add: vi.fn() } }));

import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("thread");
let renderer: ReactTestRenderer | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.serverThread = null;
  state.draftThread = null;
  state.refs = [{ name: "main", current: true, isDefault: true, worktreePath: "/repo" }];
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
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
        createNewBranch={options.createNewBranch ?? true}
        startFromRemote={null}
        onStartFromRemoteChange={vi.fn()}
      />
    );
    if (renderer) renderer.update(selector);
    else renderer = create(selector);
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
});

it("does not automatically clear a persisted thread's branch when refs arrive", async () => {
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
