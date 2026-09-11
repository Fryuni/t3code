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
    "probes without a session, streams a turn, handles approvals and resumes through ACP",
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
            source: execScriptSource({
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
        expect((yield* instance.snapshot.refresh).status).toBe("ready");
        const probeLog = yield* fs.readFileString(logPath);
        expect(probeLog).toContain('"method":"initialize"');
        expect(probeLog).not.toContain('"method":"session/new"');
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
        const turn = yield* instance.adapter
          .sendTurn({ threadId, input: "hello", attachments: [] })
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
