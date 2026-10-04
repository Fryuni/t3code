import { describe, expect, it } from "vite-plus/test";

import {
  filterNewTaskBranches,
  resolveNewTaskBranchWorktreePath,
  resolveNewTaskBranchLabel,
  resolveNewTaskBranchRemoteName,
  resolveNewTaskLocalWorkspaceSelection,
  resolveNewTaskWorktreeBranch,
} from "./new-task-context-presentation";

describe("resolveNewTaskLocalWorkspaceSelection", () => {
  it("waits for refs instead of carrying a worktree base into Current checkout", () => {
    expect(
      resolveNewTaskLocalWorkspaceSelection({
        branches: [],
        projectCwd: "/repo",
      }),
    ).toEqual({
      branch: null,
      worktreePath: null,
      awaitsCurrentBranch: true,
    });
  });

  it("adopts the checkout's current branch once refs load", () => {
    expect(
      resolveNewTaskLocalWorkspaceSelection({
        branches: [
          { name: "feature/worktree-base", current: false, worktreePath: "/worktree" },
          { name: "main", current: true, worktreePath: "/repo" },
        ],
        projectCwd: "/repo",
      }),
    ).toEqual({
      branch: "main",
      worktreePath: null,
      awaitsCurrentBranch: false,
    });
  });

  it("carries the worktree path when the current branch lives in another worktree", () => {
    expect(
      resolveNewTaskLocalWorkspaceSelection({
        branches: [
          { name: "feature/split", current: true, worktreePath: "/repo/.t3/worktrees/split" },
          { name: "main", current: false, worktreePath: "/repo" },
        ],
        projectCwd: "/repo",
      }),
    ).toEqual({
      branch: "feature/split",
      worktreePath: "/repo/.t3/worktrees/split",
      awaitsCurrentBranch: false,
    });
  });
});

describe("resolveNewTaskBranchWorktreePath", () => {
  it("moves Current checkout to the selected existing worktree", () => {
    expect(
      resolveNewTaskBranchWorktreePath({
        workspaceMode: "local",
        projectCwd: "/repo",
        branchWorktreePath: "/repo/.t3/worktrees/feature",
      }),
    ).toBe("/repo/.t3/worktrees/feature");
  });

  it("keeps the project checkout represented by a null override", () => {
    expect(
      resolveNewTaskBranchWorktreePath({
        workspaceMode: "local",
        projectCwd: "/repo",
        branchWorktreePath: "/repo",
      }),
    ).toBeNull();
  });

  it("does not reuse an existing worktree while creating a new one", () => {
    expect(
      resolveNewTaskBranchWorktreePath({
        workspaceMode: "worktree",
        projectCwd: "/repo",
        branchWorktreePath: "/repo/.t3/worktrees/feature",
      }),
    ).toBeNull();
  });
});

describe("resolveNewTaskBranchLabel", () => {
  it("shows the checked-out branch without a base-ref prefix", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "feature/mobile",
        startFromRemote: "origin",
        workspaceMode: "local",
      }),
    ).toBe("feature/mobile");
  });

  it("labels a local worktree base with From", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "main",
        startFromRemote: null,
        workspaceMode: "worktree",
      }),
    ).toBe("From main");
  });

  it("labels a remote worktree base with From origin", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "main",
        startFromRemote: "origin",
        workspaceMode: "worktree",
      }),
    ).toBe("From origin/main");
  });

  it("labels an existing branch without a base or origin prefix", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "feature/existing",
        startFromRemote: "origin",
        createNewBranch: false,
        workspaceMode: "worktree",
      }),
    ).toBe("feature/existing");
  });

  it.each([
    { branchName: "main", branchRemoteName: null },
    { branchName: "origin/main", branchRemoteName: "origin" },
    { branchName: "upstream/main", branchRemoteName: "upstream" },
  ])(
    "labels upstream base $branchName without duplicating a remote prefix",
    ({ branchName, branchRemoteName }) => {
      expect(
        resolveNewTaskBranchLabel({
          branchName,
          branchRemoteName,
          startFromRemote: "upstream",
          workspaceMode: "worktree",
        }),
      ).toBe("From upstream/main");
    },
  );

  it("uses the chosen remote for a branch selected from another configured remote", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "fork-vendor/feature/mobile",
        branchRemoteName: "fork-vendor",
        startFromRemote: "upstream",
        workspaceMode: "worktree",
      }),
    ).toBe("From upstream/feature/mobile");
  });

  it.each(
    ["origin/topic", "upstream/topic"].flatMap((branchName) =>
      (["origin", "upstream"] as const).flatMap((startFromRemote) =>
        [null, undefined].map((branchRemoteName) => ({
          branchName,
          branchRemoteName,
          startFromRemote,
        })),
      ),
    ),
  )(
    "keeps local or unresolved $branchName whole with source=$startFromRemote and metadata=$branchRemoteName",
    ({ branchName, branchRemoteName, startFromRemote }) => {
      expect(
        resolveNewTaskBranchLabel({
          branchName,
          branchRemoteName,
          startFromRemote,
          workspaceMode: "worktree",
        }),
      ).toBe(`From ${startFromRemote}/${branchName}`);
    },
  );

  it.each([
    { caseName: "selected remote is listed", listed: true },
    { caseName: "clearing search dropped it from the first page", listed: false },
  ])("keeps the selected remote source when $caseName", ({ listed }) => {
    const selectedRef = { name: "fork-vendor/topic", isRemote: true, remoteName: "fork-vendor" };
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      name: `branch-${index}`,
      isRemote: false,
    }));
    expect(
      resolveNewTaskBranchLabel({
        branchName: selectedRef.name,
        branchRemoteName: resolveNewTaskBranchRemoteName({
          branchName: selectedRef.name,
          branches: listed ? [selectedRef] : firstPage,
          queriedBranches: [selectedRef],
        }),
        startFromRemote: "upstream",
        workspaceMode: "worktree",
      }),
    ).toBe("From upstream/topic");
  });

  it.each([false, true])(
    "keeps a local branch's prefix when its name collides with a remote ref (listed local: %s)",
    (listedLocal) => {
      const localRef = { name: "origin/topic", isRemote: false };
      const remoteRef = { name: "origin/topic", isRemote: true, remoteName: "origin" };
      expect(
        resolveNewTaskBranchLabel({
          branchName: localRef.name,
          branchRemoteName: resolveNewTaskBranchRemoteName({
            branchName: localRef.name,
            branches: listedLocal ? [localRef] : [remoteRef],
            queriedBranches: listedLocal ? [remoteRef] : [localRef, remoteRef],
          }),
          startFromRemote: "upstream",
          workspaceMode: "worktree",
        }),
      ).toBe("From upstream/origin/topic");
    },
  );

  it("ignores metadata from a substring match returned by the exact-ref query", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "origin/topic",
        branchRemoteName: resolveNewTaskBranchRemoteName({
          branchName: "origin/topic",
          branches: [],
          queriedBranches: [{ name: "origin/topic-extra", isRemote: true, remoteName: "origin" }],
        }),
        startFromRemote: "upstream",
        workspaceMode: "worktree",
      }),
    ).toBe("From upstream/origin/topic");
  });

  it("prompts when no branch is available", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: null,
        startFromRemote: "origin",
        workspaceMode: "worktree",
      }),
    ).toBe("Choose branch");
  });
});

describe("resolveNewTaskWorktreeBranch", () => {
  const branches = [
    { name: "main", isRemote: false, current: true, worktreePath: "/repo" },
    { name: "feature/elsewhere", isRemote: false, current: false, worktreePath: "/worktrees/a" },
    { name: "feature/free", isRemote: false, current: false, worktreePath: null },
  ];

  it.each([
    { case: "the current checkout", selected: "main", expected: null },
    { case: "another worktree's branch", selected: "feature/elsewhere", expected: null },
    { case: "a branch that is not listed", selected: "feature/unknown", expected: null },
    { case: "a free local branch", selected: "feature/free", expected: "feature/free" },
  ])(
    "with $case selected, checking out an existing branch keeps $expected",
    ({ selected, expected }) => {
      expect(
        resolveNewTaskWorktreeBranch({
          createNewBranch: false,
          selectedBranchName: selected,
          branches,
        }),
      ).toBe(expected);
    },
  );

  it("keeps any base branch when creating a new branch", () => {
    expect(
      resolveNewTaskWorktreeBranch({
        createNewBranch: true,
        selectedBranchName: "main",
        branches,
      }),
    ).toBe("main");
  });
});

describe("filterNewTaskBranches", () => {
  const branches = [
    { name: "main", isRemote: false },
    { name: "Feature/Login-Page", isRemote: false },
    { name: "origin/fix/remote-only", isRemote: true },
  ];
  const search = (query: string) =>
    filterNewTaskBranches(branches, query).map((branch) => branch.name);

  it("ignores case in both the query and the branch name", () => {
    expect(search("feature/login")).toEqual(["Feature/Login-Page"]);
    expect(search("MAIN")).toEqual(["main"]);
  });

  it("keeps remote-only branches searchable", () => {
    expect(search("remote-only")).toEqual(["origin/fix/remote-only"]);
  });

  it("matches a typed space against the dash a branch name uses", () => {
    expect(search("  login page ")).toEqual(["Feature/Login-Page"]);
  });
});
