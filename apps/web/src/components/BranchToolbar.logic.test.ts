import { type VcsRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  dedupeRemoteBranchesWithLocalMatches,
  deriveLocalBranchNameFromRemoteRef,
  resolveBranchSelectionTarget,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
  resolveBranchToolbarPrBranch,
  resolveBranchToolbarValue,
  resolveBranchTriggerLabel,
  resolveSelectedBranchRef,
  resolveWorktreeBaseBranchCandidate,
  resolveLocalCheckoutBranchMismatch,
  sanitizeNewRefName,
  shouldIncludeBranchPickerItem,
} from "./BranchToolbar.logic";

describe("resolveDraftEnvModeAfterBranchChange", () => {
  it("switches to local mode when returning from an existing worktree to the main worktree", () => {
    expect(
      resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: null,
        currentWorktreePath: "/repo/.t3/worktrees/feature-a",
        effectiveEnvMode: "worktree",
      }),
    ).toBe("local");
  });

  it("uses worktree mode when selecting a ref already attached to a worktree", () => {
    expect(
      resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: "/repo/.t3/worktrees/feature-a",
        currentWorktreePath: null,
        effectiveEnvMode: "local",
      }),
    ).toBe("worktree");
  });
});

describe("resolveBranchToolbarValue", () => {
  it("keeps an existing-branch selection empty until the user chooses a branch", () => {
    expect(
      resolveBranchToolbarValue({
        envMode: "worktree",
        activeWorktreePath: null,
        activeThreadBranch: null,
        currentGitBranch: "main",
        createNewBranch: false,
      }),
    ).toBeNull();
  });

  it("preserves a selected existing branch", () => {
    expect(
      resolveBranchToolbarValue({
        envMode: "worktree",
        activeWorktreePath: null,
        activeThreadBranch: "feature/existing",
        currentGitBranch: "main",
        createNewBranch: false,
      }),
    ).toBe("feature/existing");
  });
});

describe("resolveWorktreeBaseBranchCandidate", () => {
  it.each([
    { case: "the repo default", createNewBranch: true, pending: false, expected: "main" },
    { case: "nothing while branches load", createNewBranch: true, pending: true, expected: null },
    {
      case: "nothing when checking out an existing branch",
      createNewBranch: false,
      pending: false,
      expected: null,
    },
  ])("defaults the base to $case", ({ createNewBranch, pending, expected }) => {
    expect(
      resolveWorktreeBaseBranchCandidate({
        createNewBranch,
        isInitialBranchesLoadPending: pending,
        projectDefaultBranch: undefined,
        defaultBranchName: "main",
        currentGitBranch: "feature/current",
      }),
    ).toBe(expected);
  });

  it("falls back to the checked-out branch without a known default", () => {
    expect(
      resolveWorktreeBaseBranchCandidate({
        createNewBranch: true,
        isInitialBranchesLoadPending: false,
        projectDefaultBranch: undefined,
        defaultBranchName: null,
        currentGitBranch: "feature/current",
      }),
    ).toBe("feature/current");
  });

  it.each([
    {
      case: "the project default ahead of the repo default",
      createNewBranch: true,
      pending: false,
      expected: "dev",
    },
    { case: "nothing while branches load", createNewBranch: true, pending: true, expected: null },
    {
      case: "nothing when checking out an existing branch",
      createNewBranch: false,
      pending: false,
      expected: null,
    },
  ])(
    "with a project default base branch, picks $case",
    ({ createNewBranch, pending, expected }) => {
      expect(
        resolveWorktreeBaseBranchCandidate({
          createNewBranch,
          isInitialBranchesLoadPending: pending,
          projectDefaultBranch: "dev",
          defaultBranchName: "main",
          currentGitBranch: "feature/current",
        }),
      ).toBe(expected);
    },
  );
});

describe("resolveSelectedBranchRef", () => {
  const localRef: VcsRef = {
    name: "origin/topic",
    isRemote: false,
    current: false,
    isDefault: false,
    worktreePath: "/repo/topic",
  };
  const remoteRef: VcsRef = {
    ...localRef,
    isRemote: true,
    remoteName: "origin",
    worktreePath: null,
  };

  it.each([
    { caseName: "both listed", listedRefs: [localRef, remoteRef], queriedRefs: [] },
    { caseName: "local queried", listedRefs: [remoteRef], queriedRefs: [localRef] },
    { caseName: "local listed", listedRefs: [localRef], queriedRefs: [remoteRef] },
  ])("keeps a local branch named like a remote ref ($caseName)", (refs) => {
    const selected = resolveSelectedBranchRef({ branchName: "origin/topic", ...refs });
    expect(selected).toBe(localRef);
    expect(
      resolveBranchTriggerLabel({
        activeWorktreePath: null,
        effectiveEnvMode: "worktree",
        resolvedActiveBranch: selected?.name ?? null,
        resolvedActiveBranchIsRemote: selected?.isRemote === true,
        startFromOrigin: true,
      }),
    ).toBe("From origin/topic (remote)");
  });

  it("uses the remote ref when no local branch has the name", () => {
    const selected = resolveSelectedBranchRef({
      branchName: "origin/topic",
      listedRefs: [],
      queriedRefs: [remoteRef],
    });
    expect(selected).toBe(remoteRef);
    expect(
      resolveBranchTriggerLabel({
        activeWorktreePath: null,
        effectiveEnvMode: "worktree",
        resolvedActiveBranch: selected?.name ?? null,
        resolvedActiveBranchIsRemote: selected?.isRemote === true,
        startFromOrigin: true,
      }),
    ).toBe("From origin/topic");
  });
});

describe("resolveBranchTriggerLabel", () => {
  it("labels an existing branch without a base or remote marker", () => {
    expect(
      resolveBranchTriggerLabel({
        activeWorktreePath: null,
        effectiveEnvMode: "worktree",
        resolvedActiveBranch: "feature/existing",
        resolvedActiveBranchIsRemote: false,
        startFromOrigin: true,
        createNewBranch: false,
      }),
    ).toBe("feature/existing");
  });
});

describe("resolveBranchToolbarPrBranch", () => {
  it("hides PR state while an optimistic branch switch is in flight", () => {
    expect(
      resolveBranchToolbarPrBranch({
        activeThreadBranch: "feature/current",
        resolvedActiveBranch: "feature/next",
      }),
    ).toBeNull();
  });
});

describe("resolveLocalCheckoutBranchMismatch", () => {
  it("detects when a local thread is associated with a different branch than the checkout", () => {
    expect(
      resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: "local",
        activeWorktreePath: null,
        activeThreadBranch: "feature/thread",
        currentGitBranch: "feature/current",
      }),
    ).toEqual({
      threadBranch: "feature/thread",
      currentBranch: "feature/current",
    });
  });

  it("ignores dedicated worktrees because their checkout is already thread-scoped", () => {
    expect(
      resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: "worktree",
        activeWorktreePath: "/repo/.t3/worktrees/feature-thread",
        activeThreadBranch: "feature/thread",
        currentGitBranch: "feature/current",
      }),
    ).toBeNull();
  });
});

describe("resolveEffectiveEnvMode", () => {
  it("keeps a server thread in worktree mode while its worktree is still being created", () => {
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: null,
        hasServerThread: true,
        draftThreadEnvMode: undefined,
        preparingWorktree: true,
      }),
    ).toBe("worktree");
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: null,
        hasServerThread: true,
        draftThreadEnvMode: undefined,
      }),
    ).toBe("local");
  });
});

describe("deriveLocalBranchNameFromRemoteRef", () => {
  it("supports remote names that contain slashes", () => {
    expect(deriveLocalBranchNameFromRemoteRef("my-org/upstream/feature/demo")).toBe(
      "upstream/feature/demo",
    );
  });
});

describe("dedupeRemoteBranchesWithLocalMatches", () => {
  it("hides remote refs when the matching local ref exists", () => {
    const input: VcsRef[] = [
      {
        name: "feature/demo",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "origin/feature/demo",
        isRemote: true,
        remoteName: "origin",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "origin/feature/remote-only",
        isRemote: true,
        remoteName: "origin",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((ref) => ref.name)).toEqual([
      "feature/demo",
      "origin/feature/remote-only",
    ]);
  });

  it("keeps non-origin remote refs visible when git tracks with first-slash local naming", () => {
    const input: VcsRef[] = [
      {
        name: "upstream/feature",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "my-org/upstream/feature",
        isRemote: true,
        remoteName: "my-org/upstream",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((ref) => ref.name)).toEqual([
      "upstream/feature",
      "my-org/upstream/feature",
    ]);
  });
});

describe("resolveBranchSelectionTarget", () => {
  it("reuses an existing secondary worktree for the selected ref", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.t3/worktrees/feature-a",
        refName: {
          isDefault: false,
          worktreePath: "/repo/.t3/worktrees/feature-b",
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo/.t3/worktrees/feature-b",
      nextWorktreePath: "/repo/.t3/worktrees/feature-b",
      reuseExistingWorktree: true,
    });
  });

  it("switches back to the main repo when the ref already lives there", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.t3/worktrees/feature-a",
        refName: {
          isDefault: true,
          worktreePath: "/repo",
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo",
      nextWorktreePath: null,
      reuseExistingWorktree: true,
    });
  });

  it("keeps checkout in the current worktree for non-default refs", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.t3/worktrees/feature-a",
        refName: {
          isDefault: false,
          worktreePath: null,
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo/.t3/worktrees/feature-a",
      nextWorktreePath: "/repo/.t3/worktrees/feature-a",
      reuseExistingWorktree: false,
    });
  });
});

describe("shouldIncludeBranchPickerItem", () => {
  it("keeps the synthetic checkout PR item visible for gh pr checkout input", () => {
    expect(
      shouldIncludeBranchPickerItem({
        itemValue: "__checkout_pull_request__:1359",
        normalizedQuery: "gh pr checkout 1359",
        createBranchItemValue: "__create_new_branch__:gh pr checkout 1359",
        checkoutPullRequestItemValue: "__checkout_pull_request__:1359",
      }),
    ).toBe(true);
  });

  it("surfaces an existing ref matching the sanitized query", () => {
    expect(
      shouldIncludeBranchPickerItem({
        itemValue: "new-branch",
        normalizedQuery: "new branch",
        createBranchItemValue: null,
        checkoutPullRequestItemValue: null,
      }),
    ).toBe(true);
  });
});

describe("sanitizeNewRefName", () => {
  it("collapses a run of whitespace into a single dash", () => {
    expect(sanitizeNewRefName("new   branch")).toBe("new-branch");
  });

  it("replaces tabs, which git rejects just like spaces", () => {
    expect(sanitizeNewRefName("new\tbranch")).toBe("new-branch");
  });

  it("preserves whitespace that git accepts", () => {
    expect(sanitizeNewRefName("new\u00a0branch")).toBe("new\u00a0branch");
    expect(sanitizeNewRefName("new\u2009branch")).toBe("new\u2009branch");
  });

  it("does not collapse dashes the user typed", () => {
    expect(sanitizeNewRefName("new - branch")).toBe("new---branch");
    expect(sanitizeNewRefName("foo--bar")).toBe("foo--bar");
  });
});
