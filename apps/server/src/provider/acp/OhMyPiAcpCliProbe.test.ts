/** Opt in with T3_OH_MY_PI_ACP_PROBE=1; initializes the installed CLI without sending a prompt. */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcessSpawner } from "effect/unstable/process";
import { makeOhMyPiAcpRuntime } from "./OhMyPiAcpSupport.ts";

it.effect.skipIf(process.env.T3_OH_MY_PI_ACP_PROBE !== "1")(
  "initializes the installed OhMyPi ACP CLI",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped();
      const agentDir = yield* fs.makeTempDirectoryScoped();
      const runtime = yield* makeOhMyPiAcpRuntime({
        ohMyPiSettings: { binaryPath: process.env.T3_OH_MY_PI_BINARY ?? "omp" },
        childProcessSpawner: yield* ChildProcessSpawner.ChildProcessSpawner,
        environment: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
        cwd,
        runtimeMode: "approval-required",
        clientInfo: { name: "t3-omp-probe", version: "0.0.0" },
      });
      const initialized = yield* runtime.initialize();
      expect(initialized.agentInfo?.name).toBe("oh-my-pi");
      expect(initialized.authMethods?.some((method) => method.id === "agent")).toBe(true);
      expect(initialized.agentCapabilities?.loadSession).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
