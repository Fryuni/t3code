import {
  OH_MY_PI_DEFAULT_MODEL,
  type OhMyPiSettings,
  type ProviderApprovalDecision,
  type ProviderOptionSelection,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as AcpErrors from "effect-acp/errors";
import type * as AcpSchema from "effect-acp/schema";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

const OH_MY_PI_CLIENT_INFO = { name: "t3-code", version: "0.0.0" } as const;
/** omp sends `available_commands_update` about fifty milliseconds after `session/new`. */
const OH_MY_PI_WORKSPACE_PROBE_TIMEOUT = Duration.seconds(20);

interface OhMyPiAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly ohMyPiSettings: Pick<OhMyPiSettings, "binaryPath">;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runtimeMode?: RuntimeMode;
  /** Launch flags appended after the approval mode; see `ohMyPiLaunchArgs`. */
  readonly launchArgs?: ReadonlyArray<string>;
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
          ...(input.launchArgs ?? []),
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

/**
 * Start a throwaway ACP session to read omp's own command list for a cwd: its
 * skills, advertised as `skill:<name>`, and every other command. omp has no
 * non-interactive listing, and its discovery walks a dozen gated directory
 * families, so mirroring it on disk would drift. See ADR 0006.
 *
 * `--session-dir` keeps the probe out of the user's resume list, since
 * `omp acp` ignores `--no-session`. The caller owns that directory.
 */
export const probeOhMyPiWorkspaceCommands = Effect.fn("probeOhMyPiWorkspaceCommands")(
  function* (input: {
    readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
    readonly ohMyPiSettings: Pick<OhMyPiSettings, "binaryPath">;
    readonly environment?: NodeJS.ProcessEnv;
    readonly cwd: string;
    readonly sessionDir: string;
  }) {
    const acp = yield* makeOhMyPiAcpRuntime({
      childProcessSpawner: input.childProcessSpawner,
      ohMyPiSettings: input.ohMyPiSettings,
      ...(input.environment ? { environment: input.environment } : {}),
      cwd: input.cwd,
      launchArgs: ["--session-dir", input.sessionDir],
      clientInfo: OH_MY_PI_CLIENT_INFO,
    });
    const commands = yield* Deferred.make<
      ReadonlyArray<AcpSchema.AvailableCommand>,
      AcpErrors.AcpError
    >();
    yield* Stream.runForEach(acp.getEvents(), (event) => {
      switch (event._tag) {
        case "EventStreamBarrier":
          return Deferred.succeed(event.acknowledge, undefined);
        case "AvailableCommandsUpdated":
          return Deferred.succeed(commands, event.availableCommands);
        case "ConnectionTerminated":
          return Deferred.fail(commands, event.error);
        default:
          return Effect.void;
      }
    }).pipe(Effect.forkScoped);
    const started = yield* acp.start();
    const available = yield* Deferred.await(commands).pipe(
      Effect.timeout(OH_MY_PI_WORKSPACE_PROBE_TIMEOUT),
    );
    yield* acp.request("session/close", { sessionId: started.sessionId }).pipe(Effect.ignore);
    return available;
  },
  Effect.scoped,
);

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
    const choices = option.options.flatMap((entry) => ("value" in entry ? [entry] : entry.options));
    // A model switch can leave a saved thinking level that the new model lacks.
    if (!choices.some((choice) => choice.value === selection.value)) continue;
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
