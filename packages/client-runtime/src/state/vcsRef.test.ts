import { describe, expect, it } from "vite-plus/test";

import { canCheckoutBranchInNewWorktree } from "./vcsRef.ts";

describe("canCheckoutBranchInNewWorktree", () => {
  it.each([
    {
      name: "an unused local branch",
      ref: { isRemote: false, current: false, worktreePath: null },
    },
    { name: "a remote ref", ref: { isRemote: true, current: false, worktreePath: null } },
  ])("allows $name", ({ ref }) => {
    expect(canCheckoutBranchInNewWorktree(ref)).toBe(true);
  });

  it.each([
    { name: "current checkout", ref: { isRemote: false, current: true, worktreePath: null } },
    {
      name: "another worktree",
      ref: { isRemote: false, current: false, worktreePath: "/worktrees/feature" },
    },
    { name: "unknown selection", ref: undefined },
    { name: "empty selection", ref: null },
  ])("requires another branch for $name", ({ ref }) => {
    expect(canCheckoutBranchInNewWorktree(ref)).toBe(false);
  });
});
