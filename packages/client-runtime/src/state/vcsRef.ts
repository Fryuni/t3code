import type { EnvironmentId, VcsRef as ContractVcsRef } from "@t3tools/contracts";

export interface VcsRefTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query?: string | null;
}

export type VcsRef = ContractVcsRef;

/** Whether an existing local branch can be checked out in a separate worktree. */
export function canCheckoutBranchInNewWorktree(
  ref: Pick<VcsRef, "isRemote" | "current" | "worktreePath"> | null | undefined,
): boolean {
  return ref != null && !ref.isRemote && !ref.current && !ref.worktreePath;
}
