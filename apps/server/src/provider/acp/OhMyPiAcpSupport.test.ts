import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as AcpSchema from "effect-acp/schema";
import { ChildProcessSpawner } from "effect/unstable/process";
import { execScriptSource, writeFakeCli } from "../../testUtils/fakeCli.ts";
import { makeOhMyPiAcpRuntime, selectOhMyPiPermissionOption } from "./OhMyPiAcpSupport.ts";

describe("OhMyPi ACP", () => {
  it.effect("launches the selected role in yolo mode without ACP model or thinking overrides", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const logPath = `${directory}/requests.jsonl`;
      const argvPath = `${directory}/argv.txt`;
      const binaryPath = yield* Effect.sync(() =>
        writeFakeCli({
          directory,
          name: "omp-role-mock",
          env: { T3_ACP_REQUEST_LOG_PATH: logPath },
          source: execScriptSource({
            scriptPath: new URL("../../../scripts/acp-mock-agent.ts", import.meta.url).pathname,
            argvLogPath: argvPath,
          }),
        }),
      );
      const runtime = yield* makeOhMyPiAcpRuntime({
        ohMyPiSettings: { binaryPath },
        childProcessSpawner: yield* ChildProcessSpawner.ChildProcessSpawner,
        cwd: directory,
        role: "slow",
        clientInfo: { name: "test", version: "0" },
      });
      yield* runtime.start();
      expect(yield* fs.readFileString(argvPath)).toContain(
        "acp\t--model\tslow\t--approval-mode\tyolo",
      );
      const requests = yield* fs.readFileString(logPath);
      expect(requests).not.toContain("session/set_config_option");
      expect(requests).not.toContain("session/set_model");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it("uses opaque permission IDs and cancels unavailable choices", () => {
    const request: AcpSchema.RequestPermissionRequest = {
      sessionId: "session",
      toolCall: { toolCallId: "tool" },
      options: [
        { optionId: "yes-42", name: "Allow", kind: "allow_once" },
        { optionId: "no-7", name: "Deny", kind: "reject_once" },
      ],
    };
    expect(selectOhMyPiPermissionOption(request, "accept")).toBe("yes-42");
    expect(selectOhMyPiPermissionOption(request, "acceptForSession")).toBe("yes-42");
    expect(selectOhMyPiPermissionOption(request, "decline")).toBe("no-7");
    expect(selectOhMyPiPermissionOption(request, "cancel")).toBeUndefined();
    expect(selectOhMyPiPermissionOption({ ...request, options: [] }, "accept")).toBeUndefined();
  });
});
