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
  const byId = new Map(input.messages.map((message) => [message.id, message]));
  const launchPrompt = input.messages.find(
    (message) => message.role === "user" && byId.has(setupMessageId(message.id, 0)),
  );
  if (launchPrompt === undefined) {
    const first = input.messages.find((message) => message.role === "user");
    return first === undefined ? null : { setupCommands: [], prompt: first };
  }
  const launch: Message[] = [];
  for (let index = 0; byId.has(setupMessageId(launchPrompt.id, index)); index++) {
    launch.push(byId.get(setupMessageId(launchPrompt.id, index))!);
  }
  launch.push(launchPrompt);
  const removed = new Set(
    input.runs.flatMap((run) => (run.status === "cancelled" ? [run.userMessageId] : [])),
  );
  const kept = launch.filter((message) => !removed.has(message.id));
  const prompt = kept.pop();
  return prompt === undefined
    ? null
    : { setupCommands: kept.map((message) => message.text), prompt };
}
