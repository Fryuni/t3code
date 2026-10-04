import type { VcsRef } from "@t3tools/contracts";

/**
 * The base a new worktree branch starts from when the user has not picked one: the project's
 * default base branch, else the repository default, else the checked-out branch. A configured
 * branch missing from `refs` is still returned, so creation surfaces git's error instead of
 * silently starting from another branch.
 */
export function resolveAutomaticWorktreeBaseBranch(input: {
  readonly configuredBranch: string | undefined;
  readonly refs: ReadonlyArray<VcsRef>;
  readonly localRefs: ReadonlyArray<VcsRef>;
}): VcsRef | null {
  if (input.configuredBranch !== undefined) {
    return (
      input.refs.find((branch) => branch.name === input.configuredBranch) ?? {
        name: input.configuredBranch,
        current: false,
        isDefault: false,
        worktreePath: null,
      }
    );
  }
  // The default may only exist as origin/<default> (isRemote), which the local refs leave out.
  return (
    input.refs.find((branch) => branch.isDefault) ??
    input.localRefs.find((branch) => branch.current) ??
    null
  );
}
