import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it, vi } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { VcsRepositoryDetectionError, type WorktreeStartRemote } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
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

const gitHandle = (rootPath: string): VcsDriverRegistry.VcsDriverHandle => ({
  kind: "git",
  repository: {
    kind: "git",
    rootPath,
    metadataPath: null,
    freshness: {
      source: "live-local",
      observedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
      expiresAt: Option.none(),
    },
  },
  driver: {} as VcsDriverRegistry.VcsDriverHandle["driver"],
});

const RealGitLayer = GitWorkflowService.layer.pipe(
  Layer.provide(
    Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
      resolve: ({ cwd }) => Effect.succeed(gitHandle(cwd)),
    }),
  ),
  Layer.provide(Layer.mock(GitManager.GitManager)({})),
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-git-workflow-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const git = (cwd: string, args: ReadonlyArray<string>) =>
  GitVcsDriver.GitVcsDriver.use((driver) =>
    driver.execute({ operation: "GitWorkflowService.test.git", cwd, args }),
  ).pipe(Effect.map((result) => result.stdout.trim()));

const makeDir = (prefix: string) =>
  FileSystem.FileSystem.use((fileSystem) => fileSystem.makeTempDirectoryScoped({ prefix }));

/** A repository on `main` with the given bare remotes configured. */
const makeRepo = (remoteNames: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const cwd = yield* makeDir("git-workflow-repo-");
    yield* git(cwd, ["init", "--initial-branch=main"]);
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* git(cwd, ["commit", "--allow-empty", "-m", "initial"]);
    yield* Effect.forEach(remoteNames, (remoteName) =>
      Effect.gen(function* () {
        const remote = yield* makeDir(`git-workflow-${remoteName}-`);
        yield* git(remote, ["init", "--bare"]);
        yield* git(cwd, ["remote", "add", remoteName, remote]);
      }),
    );
    return cwd;
  });

/**
 * Publishes a fresh commit as `branch` on `remoteName`. Pushing to the URL rather than the
 * remote name leaves `refs/remotes` untouched, so only the resolver's fetch can create them.
 */
const publishRemoteBranch = (cwd: string, remoteName: string, branch: string) =>
  Effect.gen(function* () {
    const sha = yield* git(cwd, ["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", branch]);
    const remoteUrl = yield* git(cwd, ["remote", "get-url", remoteName]);
    yield* git(cwd, ["push", "--quiet", remoteUrl, `${sha}:refs/heads/${branch}`]);
    return sha;
  });

const resolveWorktreeBase = (
  cwd: string,
  baseBranch: string,
  startFromRemote: WorktreeStartRemote,
  onFetchStart: () => Effect.Effect<void> = () => Effect.void,
) =>
  GitWorkflowService.GitWorkflowService.use((workflow) =>
    workflow.resolveWorktreeBase({ cwd, baseBranch, startFromRemote }, { onFetchStart }),
  );

describe("GitWorkflowService.resolveWorktreeBase", () => {
  it.effect.each([
    { startFromRemote: null, remotes: ["origin", "upstream"], fetches: 0, expected: "skipped" },
    { startFromRemote: "origin", remotes: ["upstream"], fetches: 0, expected: "skipped" },
    {
      startFromRemote: "origin",
      remotes: ["origin"],
      fetches: 1,
      expected: "warning",
      detail: "origin/feature/work not found, using local branch",
    },
    {
      startFromRemote: "upstream",
      remotes: ["origin"],
      fetches: 0,
      expected: "failed",
      detail: "Cannot start from upstream: the upstream remote is not configured.",
    },
    {
      startFromRemote: "upstream",
      remotes: ["origin", "upstream"],
      fetches: 1,
      expected: "failed",
      detail: "Cannot start from upstream: upstream/feature/work was not found.",
    },
  ] as const)(
    "resolves $startFromRemote with remotes $remotes and no remote branch as $expected",
    (scenario) =>
      Effect.gen(function* () {
        const cwd = yield* makeRepo(scenario.remotes);
        yield* git(cwd, ["branch", "feature/work"]);

        let fetchStarts = 0;
        const resolving = resolveWorktreeBase(cwd, "feature/work", scenario.startFromRemote, () =>
          Effect.sync(() => fetchStarts++),
        );

        if (scenario.expected === "failed") {
          assert.equal((yield* Effect.flip(resolving)).detail, scenario.detail);
        } else {
          assert.deepEqual(yield* resolving, {
            baseRef: "feature/work",
            fetchStatus: scenario.expected,
            ...("detail" in scenario ? { fetchDetail: scenario.detail } : {}),
          });
        }
        assert.equal(fetchStarts, scenario.fetches);
      }).pipe(Effect.provide(RealGitLayer)),
  );

  it.effect.each([
    { remote: "origin", baseBranch: "main", remoteBranch: "main" },
    { remote: "origin", baseBranch: "dev", remoteBranch: "dev" },
    { remote: "origin", baseBranch: "feature/dev", remoteBranch: "feature/dev" },
    { remote: "origin", baseBranch: "origin/dev", remoteBranch: "dev" },
    { remote: "origin", baseBranch: "origin/feature/dev", remoteBranch: "feature/dev" },
    { remote: "origin", baseBranch: "origin/dev", remoteBranch: "origin/dev", localBranch: true },
    {
      remote: "origin",
      baseBranch: "upstream/topic",
      remoteBranch: "upstream/topic",
      localBranch: true,
    },
    { remote: "upstream", baseBranch: "main", remoteBranch: "main" },
    { remote: "upstream", baseBranch: "feature/dev", remoteBranch: "feature/dev" },
    { remote: "upstream", baseBranch: "upstream/feature/dev", remoteBranch: "feature/dev" },
    { remote: "upstream", baseBranch: "origin/feature/dev", remoteBranch: "feature/dev" },
    { remote: "upstream", baseBranch: "mirror/feature/dev", remoteBranch: "feature/dev" },
    {
      remote: "upstream",
      baseBranch: "origin/topic",
      remoteBranch: "origin/topic",
      localBranch: true,
    },
  ] as const)("fetches $remote/$remoteBranch for base $baseBranch", (scenario) =>
    Effect.gen(function* () {
      const cwd = yield* makeRepo(["origin", "upstream", "mirror"]);
      if (scenario.localBranch) {
        yield* git(cwd, ["branch", scenario.baseBranch]);
      }
      const remoteTip = yield* publishRemoteBranch(cwd, scenario.remote, scenario.remoteBranch);

      assert.deepEqual(yield* resolveWorktreeBase(cwd, scenario.baseBranch, scenario.remote), {
        baseRef: remoteTip,
        fetchStatus: "done",
        fetchDetail: `${scenario.remote}/${scenario.remoteBranch} at ${remoteTip.slice(0, 7)}`,
      });
    }).pipe(Effect.provide(RealGitLayer)),
  );

  it.effect("fails instead of using a stale tracking ref when the upstream branch is gone", () =>
    Effect.gen(function* () {
      const cwd = yield* makeRepo(["upstream"]);
      yield* publishRemoteBranch(cwd, "upstream", "feature/work");
      assert.equal(
        (yield* resolveWorktreeBase(cwd, "feature/work", "upstream")).fetchStatus,
        "done",
      );
      const upstream = yield* git(cwd, ["remote", "get-url", "upstream"]);
      yield* git(upstream, ["update-ref", "-d", "refs/heads/feature/work"]);

      const error = yield* Effect.flip(resolveWorktreeBase(cwd, "feature/work", "upstream"));
      assert.equal(
        error.detail,
        "Cannot start from upstream: upstream/feature/work was not found.",
      );
    }).pipe(Effect.provide(RealGitLayer)),
  );

  it.effect("warns about the stripped branch when a prefixed base is missing on origin", () =>
    Effect.gen(function* () {
      const cwd = yield* makeRepo(["origin"]);

      assert.deepEqual(yield* resolveWorktreeBase(cwd, "origin/dev", "origin"), {
        baseRef: "origin/dev",
        fetchStatus: "warning",
        fetchDetail: "origin/dev not found, using local branch",
      });
    }).pipe(Effect.provide(RealGitLayer)),
  );
});

describe("GitWorkflowService", () => {
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
