import { describe, expect, it } from "vite-plus/test";

import { canCheckoutBranchInNewWorktree } from "./vcsRef.ts";

describe("canCheckoutBranchInNewWorktree", () => {
  it("allows an unused local branch", () => {
    expect(
      canCheckoutBranchInNewWorktree({ isRemote: false, current: false, worktreePath: null }),
    ).toBe(true);
  });

  it.each([
    { name: "current checkout", ref: { isRemote: false, current: true, worktreePath: null } },
    {
      name: "another worktree",
      ref: { isRemote: false, current: false, worktreePath: "/worktrees/feature" },
    },
    { name: "remote ref", ref: { isRemote: true, current: false, worktreePath: null } },
    { name: "unknown selection", ref: undefined },
    { name: "empty selection", ref: null },
  ])("requires another branch for $name", ({ ref }) => {
    expect(canCheckoutBranchInNewWorktree(ref)).toBe(false);
  });
});
