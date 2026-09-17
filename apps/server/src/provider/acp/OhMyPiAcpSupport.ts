import { type OhMyPiSettings, type ProviderApprovalDecision } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as AcpSchema from "effect-acp/schema";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

interface OhMyPiAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly ohMyPiSettings: Pick<OhMyPiSettings, "binaryPath">;
  readonly environment?: NodeJS.ProcessEnv;
  readonly role?: string | null | undefined;
}

export const makeOhMyPiAcpRuntime = Effect.fn("makeOhMyPiAcpRuntime")(function* (
  input: OhMyPiAcpRuntimeInput,
) {
  const context = yield* Layer.build(
    AcpSessionRuntime.layer({
      ...input,
      spawn: {
        command: input.ohMyPiSettings.binaryPath || "omp",
        args: ["acp", ...(input.role ? ["--model", input.role] : []), "--approval-mode", "yolo"],
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
