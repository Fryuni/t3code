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
  it("prefers the project override over git defaults and current checkout", () => {
    const branches = [
      ref("main", { isDefault: true }),
      ref("current", { current: true }),
      ref("dev"),
    ];

    expect(
      resolveAutomaticWorktreeBaseBranch({
        configuredBranch: "dev",
        refs: branches,
        localRefs: branches,
      }),
    ).toEqual(branches[2]);
  });

  it("retains a configured branch missing from refs instead of silently falling back", () => {
    expect(
      resolveAutomaticWorktreeBaseBranch({
        configuredBranch: "release/next",
        refs: [ref("main", { isDefault: true })],
        localRefs: [ref("main", { isDefault: true })],
      }),
    ).toEqual(ref("release/next"));
  });

  it("keeps existing git-default then current-checkout fallback when unset", () => {
    const current = ref("dev", { current: true });
    const defaultBranch = ref("main", { isDefault: true });

    expect(
      resolveAutomaticWorktreeBaseBranch({
        configuredBranch: undefined,
        refs: [current, defaultBranch],
        localRefs: [current, defaultBranch],
      }),
    ).toEqual(defaultBranch);
    expect(
      resolveAutomaticWorktreeBaseBranch({
        configuredBranch: undefined,
        refs: [current],
        localRefs: [current],
      }),
    ).toEqual(current);
  });
});
