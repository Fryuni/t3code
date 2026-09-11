import { describe, expect, it } from "@effect/vitest";
import { OH_MY_PI_DEFAULT_MODEL } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as AcpSchema from "effect-acp/schema";
import {
  applyOhMyPiAcpModelSelection,
  ohMyPiModelsFromConfig,
  ohMyPiApprovalMode,
  selectOhMyPiPermissionOption,
} from "./OhMyPiAcpSupport.ts";

const config: ReadonlyArray<AcpSchema.SessionConfigOption> = [
  {
    id: "model",
    category: "model",
    name: "Model",
    type: "select",
    currentValue: "anthropic/sonnet",
    options: [
      { value: "anthropic/sonnet", name: "Sonnet" },
      { value: "openai/gpt", name: "GPT" },
    ],
  },
  {
    id: "thinking",
    category: "thought_level",
    name: "Thinking",
    type: "select",
    currentValue: "high",
    options: [
      { value: "off", name: "Off" },
      { value: "high", name: "High" },
    ],
  },
];

describe("OhMyPi ACP", () => {
  it("overrides OMP's default yolo policy with the selected permission mode", () => {
    expect(ohMyPiApprovalMode("approval-required")).toBe("always-ask");
    expect(ohMyPiApprovalMode("auto")).toBe("always-ask");
    expect(ohMyPiApprovalMode("auto-accept-edits")).toBe("write");
    expect(ohMyPiApprovalMode("full-access")).toBe("yolo");
  });
  it("publishes upstream model IDs, a default alias, and native thinking choices", () => {
    const models = ohMyPiModelsFromConfig(config);
    expect(models.map((model) => model.slug)).toEqual(["anthropic/sonnet", "openai/gpt"]);
    expect(models[0]).toMatchObject({
      isDefault: true,
      aliases: [OH_MY_PI_DEFAULT_MODEL],
      subProvider: "anthropic",
      capabilities: { optionDescriptors: [{ id: "thinking", currentValue: "high" }] },
    });
  });

  it.effect("keeps the configured default and applies thinking after changing models", () =>
    Effect.gen(function* () {
      const calls: unknown[] = [];
      const runtime = {
        getConfigOptions: Effect.succeed(config),
        setModel: (model: string) =>
          Effect.sync(() => {
            calls.push(["model", model]);
          }),
        setConfigOption: (id: string, value: string | boolean) =>
          Effect.sync(() => {
            calls.push([id, value]);
            return { configOptions: config };
          }),
      };
      yield* applyOhMyPiAcpModelSelection({
        runtime,
        model: OH_MY_PI_DEFAULT_MODEL,
        selections: [],
        mapError: ({ cause }) => cause,
      });
      expect(calls).toEqual([]);
      yield* applyOhMyPiAcpModelSelection({
        runtime,
        model: "openai/gpt",
        selections: [
          { id: "thinking", value: "high" },
          { id: "mode", value: "plan" },
        ],
        mapError: ({ cause }) => cause,
      });
      expect(calls).toEqual([
        ["model", "openai/gpt"],
        ["thinking", "high"],
      ]);
    }),
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
