import { canCheckoutBranchInNewWorktree, type VcsRef } from "@t3tools/client-runtime/state/vcs";
import { sanitizeNewRefName } from "@t3tools/shared/git";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { resolveSendEnvMode } from "@t3tools/shared/projectSettings";
import type { ComposerDraftWorkspaceSelection } from "../../state/use-composer-drafts";

type WorkspaceMode = "local" | "worktree";

export function resolveNewTaskWorkspaceSelection(input: {
  readonly selection: ComposerDraftWorkspaceSelection | undefined;
  readonly fallback: ComposerDraftWorkspaceSelection;
  readonly isGitRepo: boolean;
}): ComposerDraftWorkspaceSelection {
  const selection = input.selection ?? input.fallback;
  const mode = resolveSendEnvMode({ requestedEnvMode: selection.mode, isGitRepo: input.isGitRepo });
  return input.isGitRepo ? selection : { mode, branch: null, worktreePath: null };
}

export function resolveNewTaskWorkspaceLabel(input: {
  readonly workspaceMode: WorkspaceMode;
  readonly worktreePath: string | null;
}): "Current checkout" | "Current worktree" | "New worktree" {
  if (input.workspaceMode === "worktree") {
    return "New worktree";
  }
  return input.worktreePath ? "Current worktree" : "Current checkout";
}

export function resolveNewTaskBranchWorktreePath(input: {
  readonly workspaceMode: WorkspaceMode;
  readonly projectCwd: string;
  readonly branchWorktreePath: string | null | undefined;
}): string | null {
  if (
    input.workspaceMode === "worktree" ||
    !input.branchWorktreePath ||
    input.branchWorktreePath === input.projectCwd
  ) {
    return null;
  }
  return input.branchWorktreePath;
}

export function resolveNewTaskLocalWorkspaceSelection(input: {
  readonly branches: ReadonlyArray<{
    readonly name: string;
    readonly current: boolean;
    readonly worktreePath?: string | null;
  }>;
  readonly projectCwd: string;
}): {
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly awaitsCurrentBranch: boolean;
} {
  const currentBranch = input.branches.find((branch) => branch.current) ?? null;
  if (!currentBranch) {
    return {
      branch: null,
      worktreePath: null,
      awaitsCurrentBranch: true,
    };
  }

  return {
    branch: currentBranch.name,
    worktreePath: resolveNewTaskBranchWorktreePath({
      workspaceMode: "local",
      projectCwd: input.projectCwd,
      branchWorktreePath: currentBranch.worktreePath,
    }),
    awaitsCurrentBranch: false,
  };
}

export function resolveNewTaskBranchLabel(input: {
  readonly branchName: string | null;
  readonly startFromOrigin: boolean;
  readonly createNewBranch?: boolean;
  readonly workspaceMode: WorkspaceMode;
  readonly pullRequestReference?: string;
}): string {
  if (input.workspaceMode === "worktree" && input.pullRequestReference) {
    const parsed = sourceControlClients.parseChangeRequestUrl(input.pullRequestReference);
    if (parsed) return `From ${parsed.definition.changeRequest.shortLabel} #${parsed.link.number}`;
  }
  if (!input.branchName) {
    return "Choose branch";
  }

  if (input.workspaceMode === "local" || input.createNewBranch === false) {
    return input.branchName;
  }

  // Only the server can determine a local branch's configured remote.
  return input.startFromOrigin ? `From ${input.branchName} (remote)` : `From ${input.branchName}`;
}

/**
 * The branch a draft keeps on entering New worktree or changing its create-new-branch choice.
 * Checking out an existing branch drops one that cannot be checked out again, such as the current
 * checkout.
 */
export function resolveNewTaskWorktreeBranch(input: {
  readonly createNewBranch: boolean;
  readonly selectedBranchName: string | null;
  readonly branches: ReadonlyArray<Pick<VcsRef, "name" | "isRemote" | "current" | "worktreePath">>;
}): string | null {
  if (input.createNewBranch) return input.selectedBranchName;
  const selected = input.branches.find((branch) => branch.name === input.selectedBranchName);
  return canCheckoutBranchInNewWorktree(selected) ? input.selectedBranchName : null;
}

export function shouldCheckoutNewTaskBranch(input: {
  readonly branchIsCurrent: boolean;
  readonly branchWorktreePath: string | null | undefined;
  readonly workspaceMode: WorkspaceMode;
}): boolean {
  return input.workspaceMode === "local" && !input.branchIsCurrent && !input.branchWorktreePath;
}

export function filterNewTaskBranches<T extends { readonly name: string }>(
  branches: ReadonlyArray<T>,
  rawQuery: string,
): ReadonlyArray<T> {
  const query = sanitizeNewRefName(rawQuery).toLowerCase();
  return query.length === 0
    ? branches
    : branches.filter((branch) => branch.name.toLowerCase().includes(query));
}

/**
 * A worktree with no chosen base starts from the project's default base branch, else the
 * repository default, and a local selection the user just switched to follows the current
 * checkout until refs load. Both are derived, never written back, so a late ref list or
 * t3.json default still wins.
 */
export function fillNewTaskWorkspaceBranch(input: {
  readonly selection: ComposerDraftWorkspaceSelection;
  readonly branches: ReadonlyArray<{
    readonly name: string;
    readonly current: boolean;
    readonly isDefault: boolean;
    readonly isRemote?: boolean;
    readonly worktreePath?: string | null;
  }>;
  readonly projectCwd: string | null;
  readonly worktreeDefaultSettled: boolean;
  /** Kept even when refs do not list it, so a wrong name fails instead of using another base. */
  readonly defaultBaseBranch?: string | undefined;
  /** False checks out an existing branch, which names no base to pick. */
  readonly createsBranch?: boolean;
}): ComposerDraftWorkspaceSelection {
  const { selection } = input;
  if (selection.branch !== null) return selection;
  if (selection.mode === "worktree") {
    if (input.createsBranch === false) return selection;
    // The default may only exist as origin/<default>, so search remote refs too.
    const base =
      input.defaultBaseBranch ??
      (
        input.branches.find((branch) => branch.isDefault) ??
        input.branches.find((branch) => !branch.isRemote && branch.current)
      )?.name;
    return input.worktreeDefaultSettled && base !== undefined
      ? { ...selection, branch: base, worktreePath: null }
      : selection;
  }
  if (!selection.followsCurrentCheckout || input.projectCwd === null) return selection;
  const local = resolveNewTaskLocalWorkspaceSelection({
    branches: input.branches.filter((branch) => !branch.isRemote),
    projectCwd: input.projectCwd,
  });
  return local.awaitsCurrentBranch
    ? selection
    : { ...selection, branch: local.branch, worktreePath: local.worktreePath };
}

/**
 * The workspace a new-task draft starts in: its own selection, else the
 * project's default mode, with the branch filled in as above. The new-task
 * flow, its send path and the home pending-drafts list all resolve through
 * this, so what each shows is what is sent.
 */
export function resolveNewTaskDraftWorkspace(input: {
  readonly selection: ComposerDraftWorkspaceSelection | undefined;
  readonly canChooseWorkspace: boolean;
  readonly defaultMode: WorkspaceMode;
  readonly defaultModeSettled: boolean;
  readonly isGitRepo: boolean;
  readonly branches: Parameters<typeof fillNewTaskWorkspaceBranch>[0]["branches"];
  readonly projectCwd: string | null;
  readonly defaultBaseBranch?: string | undefined;
  /** Older servers ignore `createNewBranch: false` and create a branch anyway. */
  readonly supportsExistingBranchWorktree?: boolean;
}): ComposerDraftWorkspaceSelection {
  const selection = input.canChooseWorkspace ? input.selection : undefined;
  return fillNewTaskWorkspaceBranch({
    selection: resolveNewTaskWorkspaceSelection({
      selection,
      fallback: { mode: input.defaultMode, branch: null, worktreePath: null },
      isGitRepo: input.isGitRepo,
    }),
    branches: input.branches,
    projectCwd: input.projectCwd,
    worktreeDefaultSettled: selection?.mode !== undefined || input.defaultModeSettled,
    defaultBaseBranch: input.defaultBaseBranch,
    createsBranch:
      input.supportsExistingBranchWorktree !== true || selection?.createNewBranch !== false,
  });
}
