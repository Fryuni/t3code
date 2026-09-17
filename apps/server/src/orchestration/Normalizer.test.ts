import { describe, expect, it, vi } from "vite-plus/test";
import {
  CommandId,
  type ClientOrchestrationCommand,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

import { canonicalizeClientCommandTimestamps, normalizeProviderRuntimeMode } from "./Normalizer.ts";

const clientCreatedAt = "2031-01-01T00:00:00.000Z";
const serverReceivedAt = "2026-07-18T00:00:00.000Z";

describe("canonicalizeClientCommandTimestamps", () => {
  it("replaces a client command timestamp with the server receipt timestamp", () => {
    const command: ClientOrchestrationCommand = {
      type: "project.create",
      commandId: CommandId.make("command-1"),
      projectId: ProjectId.make("project-1"),
      title: "Clock-safe project",
      workspaceRoot: "/tmp/clock-safe-project",
      createdAt: clientCreatedAt,
    };

    expect(canonicalizeClientCommandTimestamps(command, serverReceivedAt)).toEqual({
      ...command,
      createdAt: serverReceivedAt,
    });
  });

  it("replaces both timestamps when the first turn bootstraps a thread", () => {
    const command: ClientOrchestrationCommand = {
      type: "thread.turn.start",
      commandId: CommandId.make("command-2"),
      threadId: ThreadId.make("thread-1"),
      message: {
        messageId: MessageId.make("message-1"),
        role: "user",
        text: "Start a thread",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      bootstrap: {
        createThread: {
          projectId: ProjectId.make("project-1"),
          title: "Clock-safe thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: clientCreatedAt,
        },
      },
      createdAt: clientCreatedAt,
    };

    const result = canonicalizeClientCommandTimestamps(command, serverReceivedAt);

    expect(result.type).toBe("thread.turn.start");
    if (result.type !== "thread.turn.start") {
      throw new Error("Expected a thread.turn.start command");
    }
    expect(result.createdAt).toBe(serverReceivedAt);
    expect(result.bootstrap?.createThread?.createdAt).toBe(serverReceivedAt);
  });
});

describe("normalizeProviderRuntimeMode", () => {
  const command = {
    type: "thread.turn.start",
    commandId: CommandId.make("command-stale-mode"),
    threadId: ThreadId.make("thread-1"),
    message: {
      messageId: MessageId.make("message-stale-mode"),
      role: "user",
      text: "Continue",
      attachments: [],
    },
    runtimeMode: "approval-required",
    interactionMode: "default",
    createdAt: serverReceivedAt,
  } satisfies ClientOrchestrationCommand;

  it("forces stale OhMyPi turn requests to persist full access", async () => {
    const instanceId = ProviderInstanceId.make("custom-omp");
    const getInstanceInfo = vi.fn(() =>
      Effect.succeed({
        instanceId,
        driverKind: ProviderDriverKind.make("ohMyPi"),
        displayName: undefined,
        enabled: true,
        continuationIdentity: {
          driverKind: ProviderDriverKind.make("ohMyPi"),
          continuationKey: "ohMyPi:instance:custom-omp",
        },
      }),
    );
    const normalized = await Effect.runPromise(
      normalizeProviderRuntimeMode(command).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(ProviderService, { getInstanceInfo } as never),
            Layer.succeed(ProjectionSnapshotQuery, {
              getThreadShellById: () =>
                Effect.succeed(
                  Option.some({
                    modelSelection: { instanceId, model: "default" },
                  } as never),
                ),
            } as never),
          ),
        ),
      ),
    );

    if (normalized.type !== "thread.turn.start") throw new Error("Expected turn start");
    expect(normalized.runtimeMode).toBe("full-access");
    expect(getInstanceInfo).toHaveBeenCalledWith(instanceId);
  });

  it("preserves stale runtime mode requests for other provider drivers", async () => {
    const instanceId = ProviderInstanceId.make("custom-codex");
    const normalized = await Effect.runPromise(
      normalizeProviderRuntimeMode(command).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(ProviderService, {
              getInstanceInfo: () =>
                Effect.succeed({
                  instanceId,
                  driverKind: ProviderDriverKind.make("codex"),
                  displayName: undefined,
                  enabled: true,
                  continuationIdentity: {
                    driverKind: ProviderDriverKind.make("codex"),
                    continuationKey: "codex:instance:custom-codex",
                  },
                }),
            } as never),
            Layer.succeed(ProjectionSnapshotQuery, {
              getThreadShellById: () =>
                Effect.succeed(
                  Option.some({
                    modelSelection: { instanceId, model: "gpt-5" },
                  } as never),
                ),
            } as never),
          ),
        ),
      ),
    );

    if (normalized.type !== "thread.turn.start") throw new Error("Expected turn start");
    expect(normalized.runtimeMode).toBe("approval-required");
  });
});
