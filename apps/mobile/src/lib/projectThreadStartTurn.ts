import {
  CommandId,
  MessageId,
  ThreadId,
  type ChatAttachment,
  type ModelSelection,
  type OrchestrationMessageContext,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import {
  deriveThreadTitleSeed,
  parseSetupMessageId,
  setupMessageId,
  threadTitleTextFromPrompt,
} from "@t3tools/client-runtime/operations";

import type { UploadedMobileAttachment } from "./attachmentUpload";

export interface ProjectThreadStartTurnSpec {
  readonly projectId: ProjectId;
  readonly projectCwd: string;
  readonly threadId: string;
  readonly commandId: string;
  readonly messageId: string;
  readonly createdAt: string;
  readonly text: string;
  readonly titleText?: string;
  /** Sent in order before `text`; needs the server's `threadLaunchSetupMessages`. */
  readonly setupCommands?: ReadonlyArray<string>;
  readonly context?: OrchestrationMessageContext;
  readonly uploadedAttachments: ReadonlyArray<UploadedMobileAttachment | ChatAttachment>;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly workspaceMode: "local" | "worktree";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  /** Ignored when checking out an existing branch, which keeps its current commit. */
  readonly startFromOrigin: boolean;
  /** False checks out `branch` itself in the new worktree. Absent creates a branch. */
  readonly createNewBranch?: boolean;
  /** Generated temp branch for worktree mode; unused for local mode and existing branches. */
  readonly worktreeBranchName: string;
}

export function buildProjectThreadStartTurnInput(spec: ProjectThreadStartTurnSpec) {
  const title = deriveThreadTitleSeed({
    text: spec.titleText ?? spec.text,
    attachments: spec.uploadedAttachments,
  });
  const isWorktree = spec.workspaceMode === "worktree";
  return {
    commandId: CommandId.make(spec.commandId),
    creationSource: "mobile" as const,
    threadId: ThreadId.make(spec.threadId),
    message: {
      messageId: MessageId.make(spec.messageId),
      role: "user" as const,
      text: spec.text,
      ...(spec.context ? { context: spec.context } : {}),
      attachments: spec.uploadedAttachments,
    },
    modelSelection: spec.modelSelection,
    titleSeed: title,
    runtimeMode: spec.runtimeMode,
    interactionMode: spec.interactionMode,
    bootstrap: {
      createThread: {
        projectId: spec.projectId,
        title,
        modelSelection: spec.modelSelection,
        runtimeMode: spec.runtimeMode,
        interactionMode: spec.interactionMode,
        branch: spec.branch,
        worktreePath: isWorktree ? null : spec.worktreePath,
        createdAt: spec.createdAt,
      },
      ...(isWorktree
        ? {
            prepareWorktree: {
              projectCwd: spec.projectCwd,
              baseBranch: spec.branch!,
              ...(spec.createNewBranch === false
                ? { createBranch: false }
                : {
                    branch: spec.worktreeBranchName,
                    ...(spec.startFromOrigin ? { startFromOrigin: true } : {}),
                  }),
            },
            runSetupScript: true,
          }
        : {}),
      ...(spec.setupCommands?.length
        ? {
            setupMessages: spec.setupCommands.map((text, index) => ({
              messageId: setupMessageId(spec.messageId, index),
              text,
            })),
          }
        : {}),
    },
    createdAt: spec.createdAt,
  };
}

export function deriveThreadTitleFromPrompt(value: string): string {
  const title = threadTitleTextFromPrompt(value) || "New thread";
  return title.length <= 72 ? title : `${title.slice(0, 69).trimEnd()}...`;
}

/**
 * The launch to resend when worktree setup is abandoned: its setup commands in order and its
 * prompt, minus any the user removed from the queue. A thread without setup messages resends
 * its first user message, as before.
 */
export function resolveLaunchResend<
  Message extends { readonly id: string; readonly role: string; readonly text: string },
>(input: {
  readonly messages: ReadonlyArray<Message>;
  readonly runs: ReadonlyArray<{ readonly userMessageId: string | null; readonly status: string }>;
}): { readonly setupCommands: ReadonlyArray<string>; readonly prompt: Message } | null {
  const userMessages = input.messages.filter((message) => message.role === "user");
  // Snapshots can omit removed queue messages entirely, so setup ids need not be contiguous.
  const setup = userMessages.flatMap((message) => {
    const parsed = parseSetupMessageId(message.id);
    return parsed === null ? [] : [{ ...parsed, message }];
  });
  const launchPromptId = setup[0]?.promptMessageId;
  if (launchPromptId === undefined) {
    const first = userMessages[0];
    return first === undefined ? null : { setupCommands: [], prompt: first };
  }
  const removed = new Set(
    input.runs.flatMap((run) => (run.status === "cancelled" ? [run.userMessageId] : [])),
  );
  const launch = [
    ...setup
      .filter((entry) => entry.promptMessageId === launchPromptId)
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.message),
    ...userMessages.filter((message) => message.id === launchPromptId),
  ].filter((message) => !removed.has(message.id));
  const prompt = launch.pop();
  return prompt === undefined
    ? null
    : { setupCommands: launch.map((message) => message.text), prompt };
}
