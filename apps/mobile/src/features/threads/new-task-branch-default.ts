import type { VcsRef } from "@t3tools/contracts";

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
  return (
    input.refs.find((branch) => branch.isDefault) ??
    input.localRefs.find((branch) => branch.current) ??
    null
  );
}
