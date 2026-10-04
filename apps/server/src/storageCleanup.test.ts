import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "./config.ts";
import * as GitManager from "./git/GitManager.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import * as Settings from "./serverSettings.ts";
import * as StorageCleanup from "./storageCleanup.ts";
import { storageCleanupActivityAt, storageCleanupThreadIdle } from "./storageCleanup.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";

const NOW_MS = Date.parse("2026-06-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;

function at(offsetMs: number): DateTime.Utc {
  return DateTime.makeUnsafe(NOW_MS + offsetMs);
}

function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      rootThreadId: ThreadId.make("thread-1"),
      parentThreadId: null,
      relationshipToParent: null,
    },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    linkedPullRequest: null,
    status: "idle",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    createdAt: at(-30 * DAY_MS),
    updatedAt: at(-10 * DAY_MS),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

describe("V2 storage cleanup eligibility", () => {
  const candidate = () => shell({ branch: "feature", worktreePath: "/worktrees/feature" });

  it("allows an idle worktree and rejects the project checkout", () => {
    expect(storageCleanupThreadIdle(candidate(), NOW_MS)).toBe(true);
    expect(storageCleanupThreadIdle(shell(), NOW_MS)).toBe(false);
  });

  it.each(["running", "starting", "preparing", "waiting", "queued"] as const)(
    "retains a worktree while its thread is %s",
    (status) => {
      expect(storageCleanupThreadIdle(candidateWithStatus(status), NOW_MS)).toBe(false);
    },
  );

  it("retains an active run even if the shell status is idle", () => {
    expect(
      storageCleanupThreadIdle({ ...candidate(), activeRunId: RunId.make("run") }, NOW_MS),
    ).toBe(false);
  });

  it("retains a queued prompt before the new run has been projected", () => {
    expect(
      storageCleanupThreadIdle({ ...candidate(), latestUserMessageAt: at(-1_000) }, NOW_MS),
    ).toBe(false);
  });

  it("uses V2 run activity instead of metadata refreshes for retention", () => {
    const thread = candidate();
    const runTime = at(-3 * DAY_MS);
    expect(
      storageCleanupActivityAt({ ...thread, latestRunCompletedAt: runTime, updatedAt: at(0) }),
    ).toBe(DateTime.toEpochMillis(runTime));
  });

  function candidateWithStatus(status: OrchestrationV2ThreadShell["status"]) {
    return { ...candidate(), status };
  }
});

describe("V2 worktree cleanup sweep", () => {
  const TestLayer = Layer.mergeAll(
    GitVcsDriver.layer,
    SqlitePersistenceMemory,
    Settings.layerTest({ storageCleanup: { worktreeAfterDays: 7 } }),
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-storage-cleanup-" })),
    Layer.provideMerge(NodeServices.layer),
  );

  /** Runs one sweep over an inactive T3 worktree holding `files`; returns whether it survived. */
  const sweepInactiveWorktree = (files: Readonly<Record<string, string>>) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const git = yield* GitVcsDriver.GitVcsDriver;
      const repo = path.join(config.baseDir, "repo");
      const worktreePath = path.join(yield* fs.realPath(config.worktreesDir), "feature");
      yield* fs.makeDirectory(repo);
      yield* fs.writeFileString(
        path.join(repo, ".gitignore"),
        ".env\n.cache/\nbuild/\nnode_modules/\n",
      );
      for (const args of [
        ["init"],
        ["add", ".gitignore"],
        ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"],
        ["worktree", "add", "-b", "feature", worktreePath],
      ]) {
        yield* git.execute({ operation: "test.storageCleanup.setup", cwd: repo, args });
      }
      for (const [file, contents] of Object.entries(files)) {
        yield* fs.makeDirectory(path.dirname(path.join(worktreePath, file)), { recursive: true });
        yield* fs.writeFileString(path.join(worktreePath, file), contents);
      }

      const project: OrchestrationProjectShell = {
        id: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: repo,
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      };
      const thread = shell({ branch: "feature", worktreePath });
      const sweepStarted = yield* Deferred.make<void>();
      yield* TestClock.setTime(NOW_MS);
      const cleanup = yield* StorageCleanup.make.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(ProjectStore.ProjectStoreV2)({
              listShells: () => Effect.succeed([project]),
            }),
            Layer.mock(ProjectionStore.ProjectionStoreV2)({
              getShellSnapshot: (options) =>
                Deferred.succeed(sweepStarted, undefined).pipe(
                  Effect.as({
                    schemaVersion: 1,
                    snapshotSequence: 0,
                    threads: options?.location === "archive" ? [] : [thread],
                    archivedThreads: [],
                  }),
                ),
            }),
            Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.never }),
            Layer.mock(GitManager.GitManager)({ invalidateStatus: () => Effect.void }),
            Layer.mock(TerminalManager.TerminalManager)({
              subscribeMetadata: () => Effect.succeed(() => undefined),
            }),
          ),
        ),
      );
      yield* cleanup.start();
      // The sweep is in flight once it reads threads, so drain waits for it to finish.
      yield* Deferred.await(sweepStarted);
      yield* cleanup.drain;
      return yield* fs.exists(worktreePath);
    }).pipe(Effect.scoped, Effect.provide(TestLayer));

  it.effect("reclaims build output, caches, dependencies and secrets with the worktree", () =>
    Effect.gen(function* () {
      const survived = yield* sweepInactiveWorktree({
        ".env": "SECRET=1",
        ".cache/local-data": "cache",
        "build/tsconfig.tsbuildinfo": "build",
        "node_modules/dependency/index.js": "installed",
      });
      expect(survived).toBe(false);
    }),
  );

  it.effect("keeps a worktree with untracked files", () =>
    Effect.gen(function* () {
      const survived = yield* sweepInactiveWorktree({ ".env": "SECRET=1", "notes.md": "draft" });
      expect(survived).toBe(true);
    }),
  );
});
