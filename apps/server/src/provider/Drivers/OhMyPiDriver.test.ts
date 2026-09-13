// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  OH_MY_PI_DEFAULT_MODEL,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as NodeURL from "node:url";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { execScriptSource, writeFakeCli } from "../../testUtils/fakeCli.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { OhMyPiDriver } from "./OhMyPiDriver.ts";

const testLayer = ServerConfig.layerTest(process.cwd(), { prefix: "t3-omp-driver-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(
    Layer.mock(BackgroundPolicy.BackgroundPolicy)({
      shouldRunScopeWork: () => Effect.succeed(false),
    }),
  ),
  Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
);
const instanceId = ProviderInstanceId.make("omp-test");
const threadId = ThreadId.make("omp-thread");

it.layer(testLayer)("OhMyPi driver", (it) => {
  it.effect("does not start a disabled CLI", () =>
    Effect.gen(function* () {
      const instance = yield* OhMyPiDriver.create({
        instanceId,
        displayName: undefined,
        enabled: false,
        environment: [],
        config: OhMyPiDriver.defaultConfig(),
      });
      expect((yield* instance.snapshot.refresh).status).toBe("disabled");
      expect((yield* instance.snapshot.getSnapshot).supportsConversationRollback).toBe(false);
    }).pipe(
      Effect.provideService(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => Effect.die("Disabled provider spawned a process")),
      ),
      Effect.scoped,
    ),
  );

  it.effect(
    "refreshes the CLI catalog, excludes custom models, and retains models on discovery errors",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { cwd } = yield* ServerConfig;
        const directory = yield* fs.makeTempDirectoryScoped();
        const catalogFile = path.join(directory, "models.json");
        const binaryPath = yield* Effect.sync(() =>
          writeFakeCli({
            directory,
            name: "omp-models-mock",
            source: `
        if (process.cwd() !== process.env.T3_OMP_EXPECTED_CWD) process.exit(3);
        if (process.argv[2] === "--version") { process.stdout.write("omp/18.1.14"); process.exit(0); }
        if (process.argv[2] !== "models" || process.argv[3] !== "--json") process.exit(4);
        const fs = await import("node:fs");
        const output = fs.readFileSync(process.env.T3_OMP_MODEL_FILE, "utf8");
        if (output === "exit") process.exit(5);
        process.stdout.write(output);
      `,
          }),
        );
        const instance = yield* OhMyPiDriver.create({
          instanceId,
          displayName: undefined,
          enabled: true,
          environment: [
            { name: "T3_OMP_MODEL_FILE", value: catalogFile, sensitive: false },
            { name: "T3_OMP_EXPECTED_CWD", value: cwd, sensitive: false },
          ],
          config: { ...OhMyPiDriver.defaultConfig(), binaryPath, customModels: ["custom/model"] },
        });
        yield* fs.writeFileString(
          catalogFile,
          '{"models":[{"provider":"openai","id":"gpt","name":"GPT","thinking":["low","high"]},{"provider":"openai","id":"gpt","name":"duplicate"}]}',
        );
        const first = yield* instance.snapshot.refresh;
        expect(first.status).toBe("ready");
        expect(first.models.map((model) => model.slug)).toEqual([
          OH_MY_PI_DEFAULT_MODEL,
          "openai/gpt",
        ]);
        expect(first.models[1]?.capabilities?.optionDescriptors).toMatchObject([
          {
            id: "thinking",
            options: [{ id: "off" }, { id: "auto" }, { id: "low" }, { id: "high" }],
          },
        ]);
        for (const output of ["not json", "exit", '{"models":[{"name":"missing ID"}]}']) {
          yield* fs.writeFileString(catalogFile, output);
          const failed = yield* instance.snapshot.refresh;
          expect(failed.status).toBe("error");
          expect(failed.models).toEqual(first.models);
          expect(failed.message).toContain("omp models --json");
        }
        yield* fs.writeFileString(catalogFile, '{"models":[]}');
        const empty = yield* instance.snapshot.refresh;
        expect(empty.status).toBe("ready");
        expect(empty.models.map((model) => model.slug)).toEqual([OH_MY_PI_DEFAULT_MODEL]);
      }).pipe(Effect.scoped),
  );

  for (const sendDuringPreparation of [false, true]) {
    it.effect(`steers within one turn (send during preparation: ${sendDuringPreparation})`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped();
        const logPath = path.join(directory, "steering.jsonl");
        const binaryPath = yield* Effect.sync(() =>
          writeFakeCli({
            directory,
            name: "omp-steering-mock",
            env: {
              T3_ACP_REQUEST_LOG_PATH: logPath,
              T3_ACP_COMPLETE_FIRST_PROMPT_ON_CANCEL: "1",
            },
            source: execScriptSource({
              scriptPath: NodeURL.fileURLToPath(
                new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
              ),
            }),
          }),
        );
        const instance = yield* OhMyPiDriver.create({
          instanceId,
          displayName: undefined,
          enabled: true,
          environment: [],
          config: { ...OhMyPiDriver.defaultConfig(), binaryPath },
        });
        const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
        yield* instance.adapter.streamEvents.pipe(
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkChild,
        );
        yield* instance.adapter.startSession({
          threadId,
          cwd: directory,
          runtimeMode: "full-access",
        });
        const first = yield* instance.adapter
          .sendTurn({
            threadId,
            input: "long task",
            // Forces asynchronous configuration before the first prompt dispatch.
            modelSelection: { instanceId, model: "composer-2" },
          })
          .pipe(Effect.forkChild);
        const seen: ProviderRuntimeEvent[] = [];
        if (!sendDuringPreparation) {
          // Wait for a running tool; the other case submits concurrently while
          // the first call is still configuring the session.
          while (true) {
            const event = yield* Queue.take(events);
            seen.push(event);
            if (event.type === "item.updated" && event.payload.itemType === "command_execution")
              break;
          }
        }
        const steered = yield* instance.adapter.sendTurn({ threadId, input: "do this instead" });
        const original = yield* Fiber.join(first);
        while (true) {
          const event = yield* Queue.take(events);
          seen.push(event);
          if (event.type === "turn.completed") break;
        }
        expect(steered.turnId).toBe(original.turnId);
        expect(
          seen.some(
            (event) =>
              event.type === "content.delta" &&
              event.payload.streamKind === "reasoning_text" &&
              event.payload.delta === "native-cancel-received",
          ),
        ).toBe(true);
        expect(seen.filter((event) => event.type === "turn.started")).toHaveLength(1);
        expect(seen.filter((event) => event.type === "turn.completed")).toMatchObject([
          { turnId: original.turnId, payload: { state: "completed" } },
        ]);
        const requests = (yield* fs.readFileString(logPath))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { method: string });
        expect(
          requests
            .filter(
              (request) =>
                request.method === "session/prompt" || request.method === "session/cancel",
            )
            .map((request) => request.method),
        ).toEqual(["session/prompt", "session/cancel", "session/prompt"]);
        yield* instance.adapter.stopAll();
      }).pipe(Effect.scoped),
    );
  }

  it.effect("stops during attachment preparation without dispatching a prompt", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const logPath = path.join(directory, "stop-preparing.jsonl");
      const readStarted = yield* Deferred.make<void>();
      const releaseRead = yield* Deferred.make<void>();
      const binaryPath = yield* Effect.sync(() =>
        writeFakeCli({
          directory,
          name: "omp-stop-mock",
          env: { T3_ACP_REQUEST_LOG_PATH: logPath },
          source: execScriptSource({
            scriptPath: NodeURL.fileURLToPath(
              new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
            ),
          }),
        }),
      );
      const instance = yield* OhMyPiDriver.create({
        instanceId,
        displayName: undefined,
        enabled: true,
        environment: [],
        config: { ...OhMyPiDriver.defaultConfig(), binaryPath },
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          readFile: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(readStarted, undefined);
              yield* Deferred.await(releaseRead);
              return new Uint8Array([1]);
            }),
        }),
      );
      const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
      yield* instance.adapter.streamEvents.pipe(
        Stream.runForEach((event) => Queue.offer(events, event)),
        Effect.forkChild,
      );
      yield* instance.adapter.startSession({
        threadId,
        cwd: directory,
        runtimeMode: "full-access",
      });
      const sending = yield* instance.adapter
        .sendTurn({
          threadId,
          input: "read this image",
          attachments: [
            {
              type: "image",
              id: "omp-thread-00000000-0000-4000-8000-000000000000",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: 1,
            },
          ],
        })
        .pipe(Effect.forkChild);
      yield* Deferred.await(readStarted);
      yield* instance.adapter.interruptTurn(threadId);
      yield* Deferred.succeed(releaseRead, undefined);
      const stopped = yield* Fiber.join(sending);
      while (true) {
        const event = yield* Queue.take(events);
        if (event.type !== "turn.completed") continue;
        expect(event.turnId).toBe(stopped.turnId);
        expect(event.payload.state).toBe("cancelled");
        break;
      }
      expect(yield* fs.readFileString(logPath)).not.toContain('"method":"session/prompt"');
      const next = yield* instance.adapter.sendTurn({ threadId, input: "new task" });
      expect(next.turnId).not.toBe(stopped.turnId);
      expect(yield* fs.readFileString(logPath)).toContain('"method":"session/prompt"');
      yield* instance.adapter.stopAll();
    }).pipe(Effect.scoped),
  );

  it.effect.skipIf(process.env.T3_OH_MY_PI_MODELS_PROBE !== "1")(
    "discovers models from the installed OhMyPi CLI",
    () =>
      Effect.gen(function* () {
        const instance = yield* OhMyPiDriver.create({
          instanceId,
          displayName: undefined,
          enabled: true,
          environment: [],
          config: {
            ...OhMyPiDriver.defaultConfig(),
            binaryPath: process.env.T3_OH_MY_PI_BINARY ?? "omp",
          },
        });
        const snapshot = yield* instance.snapshot.refresh;
        expect(snapshot.status).toBe("ready");
        expect(
          snapshot.models.filter((model) => model.slug !== OH_MY_PI_DEFAULT_MODEL).length,
        ).toBeGreaterThan(0);
        expect(yield* instance.adapter.listSessions()).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "discovers models without starting ACP, streams a turn, handles approvals and resumes through ACP",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped();
        const logPath = path.join(directory, "requests.jsonl");
        const argvPath = path.join(directory, "argv.txt");
        const binaryPath = yield* Effect.sync(() =>
          writeFakeCli({
            directory,
            name: "omp-mock",
            env: {
              T3_ACP_REQUEST_LOG_PATH: logPath,
              T3_ACP_EMIT_TOOL_CALLS: "1",
              T3_ACP_ALLOW_ONCE_OPTION_ID: "omp-allow-42",
            },
            source:
              `
              if (process.argv[2] === "--version") {
                process.stdout.write("omp/18.1.14");
                process.exit(0);
              }
              if (process.argv[2] === "models") {
                if (process.argv[3] !== "--json") process.exit(2);
                process.stdout.write(JSON.stringify({ models: [
                  { provider: "anthropic", id: "sonnet", name: "Sonnet", thinking: ["low", "high"] },
                  { provider: "openai", id: "gpt", name: "GPT", thinking: ["high", "xhigh"] },
                ] }));
                process.exit(0);
              }
            ` +
              execScriptSource({
                scriptPath: NodeURL.fileURLToPath(
                  new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
                ),
                argvLogPath: argvPath,
              }),
          }),
        );
        const instance = yield* OhMyPiDriver.create({
          instanceId,
          displayName: "My OMP",
          enabled: true,
          environment: [],
          config: { ...OhMyPiDriver.defaultConfig(), binaryPath },
        });
        const refreshed = yield* instance.snapshot.refresh;
        expect(refreshed.status).toBe("ready");
        expect(refreshed.models.map((model) => model.slug)).toContain("anthropic/sonnet");
        expect(refreshed.models.map((model) => model.slug)).toContain("openai/gpt");
        expect(refreshed.version).toBe("18.1.14");
        expect(yield* fs.exists(logPath)).toBe(false);
        const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
        yield* instance.adapter.streamEvents.pipe(
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkChild,
        );
        const session = yield* instance.adapter.startSession({
          threadId,
          cwd: directory,
          runtimeMode: "approval-required",
          modelSelection: { instanceId, model: OH_MY_PI_DEFAULT_MODEL },
        });
        expect(session.provider).toBe("ohMyPi");
        expect((yield* instance.snapshot.getSnapshot).models).toEqual(refreshed.models);
        const turn = yield* instance.adapter
          .sendTurn({
            threadId,
            input: "hello",
            attachments: [],
            modelSelection: { instanceId, model: "composer-2" },
          })
          .pipe(Effect.forkChild);
        const seen: ProviderRuntimeEvent[] = [];
        while (true) {
          const event = yield* Queue.take(events);
          seen.push(event);
          if (event.type === "request.opened") {
            yield* instance.adapter.respondToRequest(
              threadId,
              ApprovalRequestId.make(event.requestId!),
              "accept",
            );
          }
          if (event.type === "turn.completed") break;
        }
        yield* Fiber.join(turn);
        // Session model/config changes must not rewrite the shared catalog or default.
        expect((yield* instance.snapshot.getSnapshot).models).toEqual(refreshed.models);
        expect(seen.some((event) => event.type === "content.delta")).toBe(true);
        expect(seen.some((event) => event.type === "request.resolved")).toBe(true);
        yield* instance.adapter.stopSession(threadId);
        yield* instance.adapter.startSession({
          threadId,
          cwd: directory,
          runtimeMode: "approval-required",
          resumeCursor: session.resumeCursor,
        });
        const interruptedTurn = yield* instance.adapter
          .sendTurn({ threadId, input: "wait for approval", attachments: [] })
          .pipe(Effect.forkChild);
        while ((yield* Queue.take(events)).type !== "request.opened") {}
        yield* instance.adapter.interruptTurn(threadId);
        yield* Fiber.join(interruptedTurn).pipe(Effect.exit);
        expect(yield* instance.adapter.hasSession(threadId)).toBe(true);
        const requests = yield* fs.readFileString(logPath);
        expect(requests).toContain('"methodId":"agent"');
        expect(requests).toContain('"method":"session/load"');
        expect(requests).not.toContain('"value":"oh-my-pi-default"');
        expect(yield* fs.readFileString(argvPath)).toContain("acp\t--approval-mode\talways-ask");
        yield* instance.adapter.stopAll();
        expect(yield* instance.adapter.listSessions()).toEqual([]);
      }).pipe(Effect.scoped),
  );
});
