import type { EnvironmentId, VcsRef as ContractVcsRef } from "@t3tools/contracts";

export interface VcsRefTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query?: string | null;
}

export type VcsRef = ContractVcsRef;

/**
 * Whether a branch can be checked out in a separate worktree. A remote ref checks out the
 * local branch the server creates for it.
 */
export function canCheckoutBranchInNewWorktree(
  ref: Pick<VcsRef, "current" | "worktreePath"> | null | undefined,
): boolean {
  return ref != null && !ref.current && !ref.worktreePath;
}
