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

/**
 * Whether a new worktree can start from `upstream`. Only the fork layout, with `origin` as the
 * fork and `upstream` as the canonical repository, offers it. Servers that cannot start from
 * upstream never report remote names.
 */
export function canStartWorktreeFromUpstream(
  remoteNames: ReadonlyArray<string> | undefined,
): boolean {
  return remoteNames?.includes("origin") === true && remoteNames.includes("upstream");
}
