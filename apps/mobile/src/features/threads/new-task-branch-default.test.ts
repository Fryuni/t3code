import type { VcsRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveAutomaticWorktreeBaseBranch } from "./new-task-branch-default";

const ref = (name: string, options: Partial<VcsRef> = {}): VcsRef => ({
  name,
  current: false,
  isDefault: false,
  worktreePath: null,
  ...options,
});

describe("automatic new-task worktree base branch", () => {
  it("prefers the project's default base branch over the git default and current checkout", () => {
    const branches = [
      ref("main", { isDefault: true }),
      ref("current", { current: true }),
      ref("dev", { worktreePath: "/repo/dev" }),
    ];

    expect(
      resolveAutomaticWorktreeBaseBranch({
        configuredBranch: "dev",
        refs: branches,
        localRefs: branches,
      }),
    ).toBe(branches[2]);
  });

  it("keeps a configured branch missing from refs instead of silently falling back", () => {
    expect(
      resolveAutomaticWorktreeBaseBranch({
        configuredBranch: "release/next",
        refs: [ref("main", { isDefault: true })],
        localRefs: [ref("main", { isDefault: true })],
      }),
    ).toEqual(ref("release/next"));
  });

  it.each([
    {
      case: "the git default, even when only remote",
      refs: [
        ref("dev", { current: true }),
        ref("origin/main", { isDefault: true, isRemote: true }),
      ],
      expected: "origin/main",
    },
    { case: "the current checkout", refs: [ref("dev", { current: true })], expected: "dev" },
    { case: "nothing", refs: [ref("dev")], expected: undefined },
  ])("without a project default, falls back to $case", ({ refs, expected }) => {
    expect(
      resolveAutomaticWorktreeBaseBranch({
        configuredBranch: undefined,
        refs,
        localRefs: refs.filter((branch) => !branch.isRemote),
      })?.name,
    ).toBe(expected);
  });
});
