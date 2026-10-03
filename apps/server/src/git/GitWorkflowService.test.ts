import { assert, describe, expect, it, vi } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";

import { VcsRepositoryDetectionError } from "@t3tools/contracts";

import * as GitManager from "./GitManager.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";

function makeLayer(input: {
  readonly detect: VcsDriverRegistry.VcsDriverRegistry["Service"]["detect"];
}) {
  return GitWorkflowService.layer.pipe(
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        detect: input.detect,
      }),
    ),
    Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
    Layer.provide(Layer.mock(GitManager.GitManager)({})),
  );
}

describe("GitWorkflowService", () => {
  it.effect.each([
    { remoteName: null, hasRemote: true, hasBranch: true, fetchStatus: "skipped" },
    { remoteName: "origin", hasRemote: false, hasBranch: true, fetchStatus: "skipped" },
    { remoteName: "origin", hasRemote: true, hasBranch: false, fetchStatus: "warning" },
    { remoteName: "upstream", hasRemote: false, hasBranch: true, fetchStatus: "failed" },
    { remoteName: "upstream", hasRemote: true, hasBranch: false, fetchStatus: "failed" },
  ] as const)(
    "resolves worktree base from $remoteName with remote $hasRemote and branch $hasBranch",
    ({ remoteName, hasRemote, hasBranch, fetchStatus }) => {
      const fetchRemote = vi.fn(() => Effect.void);
      const resolveRemoteTrackingCommit = vi.fn(() =>
        Effect.succeed({ commitSha: "remote-commit", remoteRefName: "upstream/feature/work" }),
      );
      const remoteExists = vi.fn(() => Effect.succeed(hasRemote));
      const remoteBranchExists = vi.fn(() => Effect.succeed(hasBranch));
      const testLayer = GitWorkflowService.layer.pipe(
        Layer.provide(
          Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
            resolve: () =>
              Effect.succeed({
                kind: "git",
                repository: {
                  kind: "git",
                  rootPath: "/repo",
                  metadataPath: null,
                  freshness: {
                    source: "live-local",
                    observedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
                    expiresAt: Option.none(),
                  },
                },
                driver: {} as VcsDriverRegistry.VcsDriverHandle["driver"],
              }),
          }),
        ),
        Layer.provide(
          Layer.mock(GitVcsDriver.GitVcsDriver)({
            execute: () =>
              Effect.succeed({
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: "origin\nupstream\n",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              }),
            remoteExists,
            remoteBranchExists,
            fetchRemote,
            resolveRemoteTrackingCommit,
          }),
        ),
        Layer.provide(Layer.mock(GitManager.GitManager)({})),
      );
      return Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const resolving = workflow.resolveWorktreeBase({
          cwd: "/repo",
          baseBranch: "feature/work",
          startFromRemote: remoteName,
        });
        if (fetchStatus === "failed") {
          const error = yield* resolving.pipe(Effect.flip);
          assert.include(error.message, "Cannot start from upstream");
        } else {
          const result = yield* resolving;
          assert.equal(result.baseRef, "feature/work");
          assert.equal(result.fetchStatus, fetchStatus);
        }
        assert.equal(fetchRemote.mock.calls.length, remoteName !== null && hasRemote ? 1 : 0);
        assert.equal(resolveRemoteTrackingCommit.mock.calls.length, 0);
      }).pipe(Effect.provide(testLayer));
    },
  );

  it.effect("reports a non-Git VCS repository as not a Git repository", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const isRepository = yield* workflow.isRepository("/jj-repo");

      assert.equal(isRepository, false);
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () =>
            Effect.succeed({
              kind: "jj",
              repository: {
                kind: "jj",
                rootPath: "/jj-repo",
                metadataPath: "/jj-repo/.jj",
                freshness: {
                  source: "live-local",
                  observedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
                  expiresAt: Option.none(),
                },
              },
              driver: {} as VcsDriverRegistry.VcsDriverHandle["driver"],
            }),
        }),
      ),
    ),
  );

  it.effect("returns an empty local status when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const status = yield* workflow.localStatus({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(status, {
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("returns an empty full status when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const status = yield* workflow.status({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(status, {
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0,
        aheadOfDefaultCount: 0,
        pr: null,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("does not call GitManager status methods when no VCS repository is detected", () => {
    const localStatus = vi.fn();
    const remoteStatus = vi.fn();
    const status = vi.fn();

    const testLayer = GitWorkflowService.layer.pipe(
      Layer.provide(
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          detect: () => Effect.succeed(null),
        }),
      ),
      Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
      Layer.provide(
        Layer.mock(GitManager.GitManager)({
          localStatus,
          remoteStatus,
          status,
        }),
      ),
    );

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      yield* workflow.localStatus({ cwd: "/not-a-repo" });
      yield* workflow.remoteStatus({ cwd: "/not-a-repo" });
      yield* workflow.status({ cwd: "/not-a-repo" });

      assert.equal(localStatus.mock.calls.length, 0);
      assert.equal(remoteStatus.mock.calls.length, 0);
      assert.equal(status.mock.calls.length, 0);
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("returns an empty ref list when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const refs = yield* workflow.listRefs({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(refs, {
        refs: [],
        isRepo: false,
        hasPrimaryRemote: false,
        nextCursor: null,
        totalCount: 0,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("structures workflow detection failures without exposing upstream details", () => {
    const cause = new VcsRepositoryDetectionError({
      operation: "VcsDriverRegistry.detect",
      cwd: "/repo",
      detail: "upstream detail must stay in the cause chain",
    });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow.status({ cwd: "/repo" }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GitManagerError",
        operation: "GitWorkflowService.status",
        cwd: "/repo",
        detail: "Failed to detect a VCS repository for this Git workflow.",
      });
      expect(error.message).not.toContain(cause.detail);
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.fail(cause),
        }),
      ),
    );
  });

  it.effect("structures command detection failures without exposing upstream details", () => {
    const cause = new VcsRepositoryDetectionError({
      operation: "VcsDriverRegistry.detect",
      cwd: "/repo",
      detail: "upstream command detail must stay in the cause chain",
    });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow.listRefs({ cwd: "/repo" }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GitCommandError",
        operation: "GitWorkflowService.listRefs",
        command: "vcs-route",
        cwd: "/repo",
        detail: "Failed to detect a VCS repository for this Git command.",
      });
      expect(error.message).not.toContain(cause.detail);
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.fail(cause),
        }),
      ),
    );
  });
});
