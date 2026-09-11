import {
  OH_MY_PI_DEFAULT_MODEL,
  type OhMyPiSettings,
  type ProviderApprovalDecision,
  type ProviderOptionSelection,
  type RuntimeMode,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as AcpErrors from "effect-acp/errors";
import type * as AcpSchema from "effect-acp/schema";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

interface OhMyPiAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly ohMyPiSettings: Pick<OhMyPiSettings, "binaryPath">;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runtimeMode?: RuntimeMode;
}

export const makeOhMyPiAcpRuntime = Effect.fn("makeOhMyPiAcpRuntime")(function* (
  input: OhMyPiAcpRuntimeInput,
) {
  const context = yield* Layer.build(
    AcpSessionRuntime.layer({
      ...input,
      spawn: {
        command: input.ohMyPiSettings.binaryPath || "omp",
        args: [
          "acp",
          ...(input.runtimeMode ? ["--approval-mode", ohMyPiApprovalMode(input.runtimeMode)] : []),
        ],
        cwd: input.cwd,
        ...(input.environment ? { env: input.environment } : {}),
      },
      authMethodId: "agent",
      // OMP runs its own tools when these capabilities are absent.
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    }).pipe(
      Layer.provide(
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
      ),
    ),
  );
  return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
});

/** Permission IDs are opaque; select by the ACP kind supplied by the agent. */
export function selectOhMyPiPermissionOption(
  request: AcpSchema.RequestPermissionRequest,
  decision: ProviderApprovalDecision,
): string | undefined {
  if (decision === "cancel") return undefined;
  const kind =
    decision === "acceptForSession"
      ? "allow_always"
      : decision === "accept"
        ? "allow_once"
        : "reject_once";
  return (
    request.options.find((option) => option.kind === kind)?.optionId ??
    (decision === "acceptForSession"
      ? request.options.find((option) => option.kind === "allow_once")?.optionId
      : undefined)
  );
}

export function ohMyPiModelsFromConfig(
  options: ReadonlyArray<AcpSchema.SessionConfigOption>,
): ReadonlyArray<ServerProviderModel> {
  const model = options.find((option) => option.category === "model" || option.id === "model");
  if (model?.type !== "select") return [];
  const thinking = options.find((option) => option.category === "thought_level");
  const capabilities = createModelCapabilities({
    optionDescriptors:
      thinking?.type === "select"
        ? [
            {
              id: thinking.id,
              label: thinking.name,
              type: "select",
              currentValue: thinking.currentValue,
              options: thinking.options
                .flatMap((entry) => ("value" in entry ? [entry] : entry.options))
                .map((entry) => ({ id: entry.value, label: entry.name })),
            },
          ]
        : [],
  });
  const seen = new Set<string>();
  return model.options
    .flatMap((entry) => ("value" in entry ? [entry] : entry.options))
    .flatMap((entry): ServerProviderModel[] => {
      if (!entry.value.trim() || seen.has(entry.value)) return [];
      seen.add(entry.value);
      return [
        {
          slug: entry.value,
          name: entry.name || entry.value,
          subProvider: entry.value.split("/")[0],
          isCustom: false,
          ...(entry.value === model.currentValue
            ? { isDefault: true, aliases: [OH_MY_PI_DEFAULT_MODEL] }
            : {}),
          capabilities,
        },
      ];
    });
}

export const applyOhMyPiAcpModelSelection = Effect.fn("applyOhMyPiAcpModelSelection")(function* <
  E,
>(input: {
  readonly runtime: Pick<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    "getConfigOptions" | "setModel" | "setConfigOption"
  >;
  readonly model: string | null | undefined;
  readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly mapError: (context: { readonly cause: AcpErrors.AcpError }) => E;
}) {
  if (input.model && input.model !== OH_MY_PI_DEFAULT_MODEL) {
    yield* input.runtime
      .setModel(input.model)
      .pipe(Effect.mapError((cause) => input.mapError({ cause })));
  }
  // The model change can alter the available thinking levels.
  const config = yield* input.runtime.getConfigOptions;
  for (const selection of input.selections ?? []) {
    const option = config.find(
      (entry) => entry.id === selection.id && entry.category === "thought_level",
    );
    if (!option || option.type !== "select") continue;
    yield* input.runtime
      .setConfigOption(option.id, selection.value)
      .pipe(Effect.mapError((cause) => input.mapError({ cause })));
  }
});

export function ohMyPiApprovalMode(mode: RuntimeMode): string {
  switch (mode) {
    case "full-access":
      return "yolo";
    case "auto-accept-edits":
      return "write";
    case "auto":
    case "approval-required":
      return "always-ask";
  }
}
