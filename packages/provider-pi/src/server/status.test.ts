import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { checkPiProviderStatus, MINIMUM_PI_VERSION } from "./status.ts";

const encoder = new TextEncoder();
const decodeRpcRequest = Schema.decodeSync(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, type: Schema.String })),
);
const encodeJsonLine = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function processHandle(input: {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}) {
  const bytes = (value: string | undefined) =>
    value === undefined || value.length === 0
      ? Stream.empty
      : Stream.succeed(encoder.encode(value));
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(900_000_001),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(input.exitCode ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: bytes(input.stdout),
    stderr: bytes(input.stderr),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function piProbeSpawner(version: string) {
  return ChildProcessSpawner.make((command) => {
    const args = ChildProcess.isStandardCommand(command) ? command.args : [];
    return Effect.succeed(
      args.includes("--version")
        ? processHandle({ stdout: `pi ${version}\n` })
        : processHandle({ stderr: "RPC startup failed", exitCode: 1 }),
    );
  });
}

const piDiscoverySpawner = (
  inventory: unknown,
  omp?: {
    readonly modelPresets: unknown;
    readonly configCalls: Array<string>;
    readonly stall?: Deferred.Deferred<void>;
    /** The models reply is held from `requested` until the test completes `release`. */
    readonly slowModels?: {
      readonly requested: Deferred.Deferred<void>;
      readonly release: Deferred.Deferred<void>;
    };
  },
) =>
  Effect.gen(function* () {
    const stdout = yield* Queue.unbounded<Uint8Array, Cause.Done>();
    let stdinBuffer = "";
    const stdin = Sink.forEach((chunk: Uint8Array) =>
      Effect.gen(function* () {
        stdinBuffer += new TextDecoder().decode(chunk);
        while (true) {
          const newline = stdinBuffer.indexOf("\n");
          if (newline === -1) return;
          const line = stdinBuffer.slice(0, newline);
          stdinBuffer = stdinBuffer.slice(newline + 1);
          if (line.length === 0) continue;
          const request = decodeRpcRequest(line);
          if (request.type === "get_available_models" && omp?.slowModels !== undefined) {
            yield* Deferred.succeed(omp.slowModels.requested, undefined);
            yield* Deferred.await(omp.slowModels.release);
          }
          const data =
            request.type === "get_available_models"
              ? inventory
              : request.type === "get_commands"
                ? { commands: [] }
                : {};
          yield* Queue.offer(
            stdout,
            encoder.encode(
              `${encodeJsonLine({ type: "response", id: request.id, command: request.type, success: true, data })}\n`,
            ),
          );
        }
      }),
    );
    return ChildProcessSpawner.make((command) => {
      const args = ChildProcess.isStandardCommand(command) ? command.args : [];
      if (args.includes("config")) {
        omp?.configCalls.push(args.join(" "));
        if (omp?.stall !== undefined) {
          return Deferred.succeed(omp.stall, undefined).pipe(
            Effect.as(
              ChildProcessSpawner.makeHandle({
                ...processHandle({}),
                exitCode: Effect.never,
                stdout: Stream.never,
              }),
            ),
          );
        }
        return Effect.succeed(
          processHandle({ stdout: encodeJsonLine({ value: omp?.modelPresets }) }),
        );
      }
      return Effect.succeed(
        args.includes("--version")
          ? processHandle({ stdout: omp === undefined ? "pi 0.84.3\n" : "omp/18.5.1\n" })
          : ChildProcessSpawner.makeHandle({
              ...processHandle({}),
              exitCode: Effect.never,
              isRunning: Effect.succeed(true),
              stdin,
              stdout: Stream.fromQueue(stdout),
            }),
      );
    });
  });

const settings = {
  enabled: true,
  binaryPath: "pi",
  launchArgs: "",
  customModels: [],
} as const;

describe("PiProvider", () => {
  it.effect("requires the first published Pi version with entries and settlement hooks", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus(settings).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, piProbeSpawner("0.80.3")),
      );
      assert.equal(snapshot.status, "error");
      assert.equal(snapshot.version, "0.80.3");
      assert.include(snapshot.message ?? "", `Pi ${MINIMUM_PI_VERSION} or newer`);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps compatible Pi selectable when optional discovery fails", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus(settings).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, piProbeSpawner("0.84.3")),
      );
      assert.equal(snapshot.status, "ready");
      assert.equal(snapshot.auth.status, "unknown");
      assert.deepEqual(
        snapshot.models.map((model) => model.slug),
        ["default"],
      );
      assert.include(snapshot.message ?? "", "could not refresh its models and commands");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a known unauthenticated inventory when Pi returns no usable models", () =>
    Effect.gen(function* () {
      const spawner = yield* piDiscoverySpawner({ models: [] });
      const snapshot = yield* checkPiProviderStatus(settings).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      assert.equal(snapshot.status, "warning");
      assert.equal(snapshot.auth.status, "unauthenticated");
      assert.deepEqual(
        snapshot.models.map((model) => model.slug),
        ["default"],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("lists OhMyPi presets as models that start at the preset's thinking level", () =>
    Effect.gen(function* () {
      const configCalls: Array<string> = [];
      const spawner = yield* piDiscoverySpawner(
        {
          models: [
            { provider: "anthropic", id: "claude-opus", reasoning: true },
            { provider: "openai", id: "gpt" },
          ],
        },
        {
          configCalls,
          modelPresets: {
            OpenAI: { modelRoles: { default: "openai/gpt" }, defaultThinkingLevel: "min" },
            Anthropic: { modelRoles: { default: "anthropic/claude-opus:low" } },
            Broken: { modelRoles: { default: "" } },
            NumericThinking: { modelRoles: { default: "openai/gpt" }, defaultThinkingLevel: 42 },
            UnknownThinking: { modelRoles: { default: "openai/gpt" }, defaultThinkingLevel: "x" },
            NoMainModel: { modelRoles: { task: "openai/gpt" } },
          },
        },
      );
      const snapshot = yield* checkPiProviderStatus({
        ...settings,
        binaryPath: "omp",
        launchArgs: "--profile work",
      }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
      assert.deepEqual(configCalls, ["--profile work config get modelPresets --json"]);
      assert.deepEqual(
        snapshot.models.map((model) => [model.slug, model.subProvider]),
        [
          ["default", undefined],
          ["preset:Anthropic", "Preset"],
          ["preset:OpenAI", "Preset"],
          ["anthropic/claude-opus", "anthropic"],
          ["openai/gpt", "openai"],
        ],
      );
      const thinking = snapshot.models[1]?.capabilities?.optionDescriptors?.[0];
      assert.equal(thinking?.id, "thinking");
      assert.deepEqual(
        thinking?.type === "select"
          ? thinking.options.filter((option) => option.isDefault).map((option) => option.id)
          : [],
        ["low"],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps discovered models when OhMyPi preset discovery stalls after slow RPC", () =>
    Effect.gen(function* () {
      const stall = yield* Deferred.make<void>();
      const slowModels = {
        requested: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
      };
      const spawner = yield* piDiscoverySpawner(
        { models: [{ provider: "openai", id: "gpt" }] },
        { configCalls: [], modelPresets: {}, stall, slowModels },
      );
      const fiber = yield* checkPiProviderStatus({ ...settings, binaryPath: "omp" }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.forkChild,
      );
      // RPC discovery uses 25 of its 30 seconds before the preset read starts.
      yield* Deferred.await(slowModels.requested);
      yield* TestClock.adjust("25 seconds");
      yield* Deferred.succeed(slowModels.release, undefined);
      yield* Deferred.await(stall);
      yield* TestClock.adjust("10 seconds");
      const snapshot = yield* Fiber.join(fiber);
      assert.equal(snapshot.auth.status, "authenticated");
      assert.deepEqual(
        snapshot.models.map((model) => model.slug),
        ["default", "openai/gpt"],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  // regression: #18498 a malformed model inventory must not restore stale Pi models
  it.effect.each([
    ["missing models", {}],
    ["missing model id", { models: [{ provider: "anthropic" }] }],
    [
      "mixed valid and invalid models",
      { models: [{ provider: "anthropic", id: "claude-sonnet-4" }, { provider: "openrouter" }] },
    ],
  ] as const)("reports unknown authentication when Pi discovery returns %s", (_label, inventory) =>
    Effect.gen(function* () {
      const spawner = yield* piDiscoverySpawner(inventory);
      const snapshot = yield* checkPiProviderStatus(settings).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      assert.equal(snapshot.status, "ready");
      assert.equal(snapshot.auth.status, "unknown");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
