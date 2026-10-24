import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { serializeComposerMessageForServer } from "./composerContext";

import {
  buildProjectThreadStartTurnInput,
  resolveLaunchResend,
  type ProjectThreadStartTurnSpec,
} from "./projectThreadStartTurn";

describe("project thread title", () => {
  it.each([
    {
      type: "image" as const,
      name: "photo.png",
      mimeType: "image/png",
      text: "![photo.png](t3-context://v1/image/photo)",
      title: "Attached image",
    },
    {
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      text: "",
      title: "File: report.pdf",
    },
    {
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      text: "[report.pdf](t3-context://v1/file/report)",
      title: "report.pdf",
    },
  ])("titles a $type-only message without changing its data", ({ text, title, ...attachment }) => {
    const uploadedAttachments = [{ ...attachment, id: "prepared-attachment", sizeBytes: 3 }];
    const wire = serializeComposerMessageForServer(text, undefined, true);
    const spec = {
      projectId: ProjectId.make("project"),
      projectCwd: "/workspace",
      threadId: "image-thread",
      commandId: "image-command",
      messageId: "image-message",
      createdAt: "2026-09-04T00:00:00Z",
      ...wire,
      titleText: text,
      uploadedAttachments,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceMode: "local",
      branch: null,
      worktreePath: null,
      startFromOrigin: false,
      worktreeBranchName: "unused",
    } satisfies ProjectThreadStartTurnSpec;
    const input = buildProjectThreadStartTurnInput(spec);

    expect(input.titleSeed).toBe(title);
    expect(input.bootstrap.createThread.title).toBe(input.titleSeed);
    expect(input.message.attachments).toEqual(uploadedAttachments);
    expect(input.message.text).toBe(wire.text);
    const relaunched = buildProjectThreadStartTurnInput({
      ...spec,
      threadId: "local-relaunch",
      text: input.message.text,
      titleText: input.bootstrap.createThread.title,
    });
    expect(relaunched.titleSeed).toBe(title);
    expect(relaunched.message.text).toBe(wire.text);
    expect(relaunched.message.attachments).toEqual(uploadedAttachments);
  });
});

describe("new worktree branch choice", () => {
  it.each(
    [undefined, true, false].flatMap((createNewBranch) =>
      [false, true].map((startFromOrigin) => ({
        createNewBranch,
        startFromOrigin,
        prepareWorktree:
          createNewBranch === false
            ? { projectCwd: "/workspace", baseBranch: "feature/existing", createBranch: false }
            : {
                projectCwd: "/workspace",
                baseBranch: "feature/existing",
                branch: "t3code/new-branch",
                ...(startFromOrigin ? { startFromOrigin: true } : {}),
              },
      })),
    ),
  )(
    "prepares the worktree for createNewBranch=$createNewBranch and startFromOrigin=$startFromOrigin",
    ({ createNewBranch, startFromOrigin, prepareWorktree }) => {
      const input = buildProjectThreadStartTurnInput({
        projectId: ProjectId.make("project"),
        projectCwd: "/workspace",
        threadId: "new-thread",
        commandId: "command",
        messageId: "message",
        createdAt: "2026-09-06T00:00:00Z",
        text: "Continue working",
        uploadedAttachments: [],
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
        runtimeMode: "full-access",
        interactionMode: "default",
        workspaceMode: "worktree",
        branch: "feature/existing",
        worktreePath: null,
        startFromOrigin,
        ...(createNewBranch === undefined ? {} : { createNewBranch }),
        worktreeBranchName: "t3code/new-branch",
      });

      expect(input.bootstrap.prepareWorktree).toEqual(prepareWorktree);
      expect(input.bootstrap.createThread.branch).toBe("feature/existing");
    },
  );
});

describe("resolveLaunchResend", () => {
  const message = (id: string, text: string) => ({ id, role: "user", text, attachments: [] });

  it("follows run order and leaves follow-ups queued after the prompt behind", () => {
    const resend = resolveLaunchResend({
      runs: [
        { ordinal: 4, userMessageId: "m4" },
        { ordinal: 2, userMessageId: "m:setup:1" },
        { ordinal: 1, userMessageId: "m:setup:0" },
        { ordinal: 3, userMessageId: "m" },
      ],
      // Equal timestamps sort queued messages by id, which puts the prompt between commands.
      messages: [
        message("m:setup:0", "/one"),
        message("m", "Fix bug"),
        message("m:setup:1", "/two on"),
        message("m4", "Also add tests"),
      ],
    });
    expect(resend?.setupCommands).toEqual(["/one", "/two on"]);
    expect(resend?.prompt.text).toBe("Fix bug");
  });

  it("keeps the last command as the prompt of a commands-only launch", () => {
    const resend = resolveLaunchResend({
      runs: [
        { ordinal: 1, userMessageId: "a" },
        { ordinal: 2, userMessageId: "b" },
      ],
      messages: [message("a", "/one"), message("b", "/two")],
    });
    expect(resend?.setupCommands).toEqual(["/one"]);
    expect(resend?.prompt.text).toBe("/two");
  });
});
