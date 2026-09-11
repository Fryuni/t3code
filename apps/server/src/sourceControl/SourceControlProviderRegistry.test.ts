import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";
import { detectSourceControlProviderFromRemoteUrl } from "@t3tools/shared/sourceControl";
import { ChildProcessSpawner } from "effect/unstable/process";
import { VcsRepositoryDetectionError } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import type * as VcsDriver from "../vcs/VcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as AzureDevOpsCli from "./AzureDevOpsCli.ts";
import * as BitbucketApi from "./BitbucketApi.ts";
import * as GitHubCli from "./GitHubCli.ts";
import * as ForgejoCli from "./ForgejoCli.ts";
import { discovery as forgejoDiscovery } from "./forgejoAuth.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as GitLabCli from "./GitLabCli.ts";
import * as SourceControlProviderRegistry from "./SourceControlProviderRegistry.ts";

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

const processOutput = (
  stdout: string,
  options?: {
    readonly stderr?: string;
    readonly exitCode?: ChildProcessSpawner.ExitCode;
  },
): VcsProcess.VcsProcessOutput => ({
  exitCode: options?.exitCode ?? ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: options?.stderr ?? "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

function makeRegistry(input: {
  readonly remotes: ReadonlyArray<{
    readonly name: string;
    readonly url: string;
  }>;
  readonly process?: Partial<VcsProcess.VcsProcess["Service"]>;
  readonly resolve?: VcsDriverRegistry.VcsDriverRegistry["Service"]["resolve"];
}) {
  const driver = {
    listRemotes: () =>
      Effect.succeed({
        remotes: input.remotes.map((remote) => ({
          ...remote,
          pushUrl: Option.none(),
          isPrimary: remote.name === "origin",
        })),
        freshness: {
          source: "live-local" as const,
          observedAt: TEST_EPOCH,
          expiresAt: Option.none(),
        },
      }),
  } satisfies Partial<VcsDriver.VcsDriver["Service"]>;

  const registryLayer = Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
    get: () => Effect.succeed(driver as unknown as VcsDriver.VcsDriver["Service"]),
    resolve:
      input.resolve ??
      (() =>
        Effect.succeed({
          kind: "git",
          repository: {
            kind: "git",
            rootPath: "/repo",
            metadataPath: null,
            freshness: {
              source: "live-local" as const,
              observedAt: TEST_EPOCH,
              expiresAt: Option.none(),
            },
          },
          driver: driver as unknown as VcsDriver.VcsDriver["Service"],
        })),
  });

  const processLayer = Layer.mock(VcsProcess.VcsProcess)({
    run: () => Effect.succeed(processOutput("")),
    ...input.process,
  });

  return SourceControlProviderRegistry.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        registryLayer,
        processLayer,
        Layer.mock(AzureDevOpsCli.AzureDevOpsCli)({}),
        Layer.mock(BitbucketApi.BitbucketApi)({}),
        Layer.mock(GitHubCli.GitHubCli)({}),
        Layer.mock(GitLabCli.GitLabCli)({}),
        Layer.mock(ForgejoCli.ForgejoCli)({
          refineUnknownRemote: (input) =>
            Effect.succeed(forgejoDiscovery.refineUnknownRemote(input)),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({}),
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-source-control-registry-test-",
        }).pipe(Layer.provide(NodeServices.layer)),
      ),
    ),
  );
}

it.effect("routes GitHub remotes to the GitHub provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@github.com:pingdotgg/t3code.git" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "github");
  }),
);

it.effect("routes directly by provider kind for remote-first workflows", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [],
    });

    const provider = yield* registry.get("github");

    assert.strictEqual(provider.kind, "github");
  }),
);

it.effect("includes the request cwd when an unregistered provider is used", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({ remotes: [] });
    const provider = yield* registry.get("unknown");

    const error = yield* provider
      .getChangeRequest({ cwd: "/repo", reference: "#42" })
      .pipe(Effect.flip);

    assert.strictEqual(error.provider, "unknown");
    assert.strictEqual(error.operation, "getChangeRequest");
    assert.strictEqual(error.cwd, "/repo");
    assert.strictEqual(error.reference, "#42");
  }),
);

it.effect("retains VCS detection failures with structured cwd context", () =>
  Effect.gen(function* () {
    const cause = new VcsRepositoryDetectionError({
      operation: "resolve",
      cwd: "/repo",
      detail: "raw VCS detection failure",
      cause: new Error("raw nested failure"),
    });
    const registry = yield* makeRegistry({
      remotes: [],
      resolve: () => Effect.fail(cause),
    });

    const error = yield* registry.resolve({ cwd: "/repo" }).pipe(Effect.flip);

    assert.strictEqual(error.provider, "unknown");
    assert.strictEqual(error.operation, "detectProvider");
    assert.strictEqual(error.cwd, "/repo");
    assert.strictEqual(error.detail, "Failed to detect source control provider.");
    assert.strictEqual(error.cause, cause);
    assert.equal(error.message.includes(cause.message), false);
  }),
);

it.effect("routes GitLab remotes to the GitLab provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@gitlab.com:group/project.git" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "gitlab");
  }),
);

it.effect("routes all authenticated Forgejo instances and caches detection", () =>
  Effect.gen(function* () {
    const calls: VcsProcess.VcsProcessInput[] = [];
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "ssh://git@code.example.test:2222/Owner/Repo.git" }],
      process: {
        run: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return processOutput(
              input.command === "fj" ? "codeberg.org\ncode.example.test:8443" : "",
            );
          }),
      },
    });
    const handle = yield* registry.resolveHandle({ cwd: "/repo" });
    assert.strictEqual(handle.provider.kind, "forgejo");
    assert.strictEqual(handle.context?.provider.baseUrl, "https://code.example.test:8443");
    const count = calls.length;
    yield* registry.resolve({ cwd: "/repo" });
    assert.strictEqual(calls.length, count);
    assert.deepStrictEqual(calls.find((call) => call.command === "fj")?.args, ["auth", "list"]);
  }),
);

it.effect("shares cached refinement across status contexts and default-remote detection", () =>
  Effect.gen(function* () {
    const remoteUrl = "ssh://git@code.example.test:2222/Owner/Repo.git";
    let probes = 0;
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: remoteUrl }],
      process: {
        run: () =>
          Effect.sync(() => {
            probes++;
            return processOutput("code.example.test:8443");
          }),
      },
    });
    const context = (url = remoteUrl) => ({
      provider: detectSourceControlProviderFromRemoteUrl(url)!,
      remoteName: "origin",
      remoteUrl: url,
    });
    const handles = yield* Effect.all(
      [
        registry.resolveHandle({ cwd: "/repo", context: context() }),
        registry.resolveHandle({ cwd: "/repo", context: context() }),
      ],
      { concurrency: "unbounded" },
    );
    assert.strictEqual(handles[0]?.provider.kind, "forgejo");
    assert.strictEqual(probes, 1);
    yield* TestClock.adjust("6 seconds");
    yield* registry.resolveHandle({ cwd: "/repo", context: context() });
    yield* registry.resolveHandle({ cwd: "/repo" });
    assert.strictEqual(probes, 1);
    const changed = yield* registry.resolveHandle({
      cwd: "/repo",
      context: context("ssh://git@code.example.test:2222/Other/Repo.git"),
    });
    assert.strictEqual(
      changed.context?.remoteUrl,
      "ssh://git@code.example.test:2222/Other/Repo.git",
    );
    assert.strictEqual(probes, 2);
    yield* TestClock.adjust("1 minute");
    yield* registry.resolveHandle({ cwd: "/repo", context: context() });
    assert.strictEqual(probes, 3);
  }),
);

it.effect("caches unmatched remotes but discovers a new login after expiry", () =>
  Effect.gen(function* () {
    const remoteUrl = "https://code.example.test/Owner/Repo.git";
    let authenticated = false;
    const calls: VcsProcess.VcsProcessInput[] = [];
    const registry = yield* makeRegistry({
      remotes: [],
      process: {
        run: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return processOutput(
              authenticated && input.command === "fj" ? "code.example.test" : "",
            );
          }),
      },
    });
    const resolve = () =>
      registry.resolveHandle({
        cwd: "/repo",
        context: {
          remoteName: "origin",
          remoteUrl,
          provider: detectSourceControlProviderFromRemoteUrl(remoteUrl)!,
        },
      });
    assert.strictEqual((yield* resolve()).provider.kind, "unknown");
    const firstProbeCount = calls.length;
    assert.isAbove(firstProbeCount, 0);
    authenticated = true;
    yield* TestClock.adjust("6 seconds");
    assert.strictEqual((yield* resolve()).provider.kind, "unknown");
    assert.strictEqual(calls.length, firstProbeCount);
    yield* TestClock.adjust("1 minute");
    assert.strictEqual((yield* resolve()).provider.kind, "forgejo");
    assert.strictEqual(calls.length, firstProbeCount + 1);
  }),
);

it.effect("routes authenticated self-hosted GitLab remotes without relying on host naming", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "https://self-hosted.example.test/group/project.git" }],
      process: {
        run: ({ command }) =>
          command !== "glab"
            ? Effect.succeed(processOutput(""))
            : Effect.succeed(
                processOutput(
                  `gitlab.com
  x gitlab.com: API call failed: 401 Unauthorized
  ! No token found
self-hosted.example.test
  ✓ Logged in to self-hosted.example.test as gitlab-user
  ✓ Token found: ******
`,
                  { exitCode: ChildProcessSpawner.ExitCode(1) },
                ),
              ),
      },
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "gitlab");
  }),
);

it.effect("refines the caller-selected remote instead of choosing another configured remote", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@github.com:fork/project.git" }],
      process: {
        run: ({ command }) =>
          command !== "glab"
            ? Effect.succeed(processOutput(""))
            : Effect.succeed(
                processOutput(`self-hosted.example.test
  ✓ Logged in to self-hosted.example.test as gitlab-user
`),
              ),
      },
    });

    const handle = yield* registry.resolveHandle({
      cwd: "/repo",
      context: {
        provider: {
          kind: "unknown",
          name: "self-hosted.example.test",
          baseUrl: "https://self-hosted.example.test",
        },
        remoteName: "upstream",
        remoteUrl: "https://self-hosted.example.test/group/project.git",
      },
    });

    assert.strictEqual(handle.context?.provider.kind, "gitlab");
    assert.strictEqual(handle.context?.remoteName, "upstream");
  }),
);

it.effect("routes authenticated self-hosted GitLab remotes on non-standard ports", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "https://self-hosted.example.test:8443/group/project.git" }],
      process: {
        run: ({ command }) =>
          command !== "glab"
            ? Effect.succeed(processOutput(""))
            : Effect.succeed(
                processOutput(
                  `self-hosted.example.test:8443
  ✓ Logged in to self-hosted.example.test:8443 as gitlab-user
  ✓ Token found: ******
`,
                ),
              ),
      },
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "gitlab");
  }),
);

it.effect("routes Bitbucket remotes to the Bitbucket provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@bitbucket.org:pingdotgg/t3code.git" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "bitbucket");
  }),
);

it.effect("routes Azure DevOps remotes to the Azure DevOps provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "https://dev.azure.com/acme/project/_git/repo" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "azure-devops");
  }),
);

it.effect("falls back to a non-origin remote when origin is not configured", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "upstream", url: "https://dev.azure.com/acme/project/_git/repo" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "azure-devops");
  }),
);
