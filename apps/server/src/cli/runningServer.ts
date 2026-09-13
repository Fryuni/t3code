import { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { resolveWorktreeT3Home } from "@t3tools/shared/devHome";
import { DEFAULT_TAILSCALE_SERVE_PORT } from "@t3tools/tailscale";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import { resolveBaseDir } from "../os-jank.ts";
import {
  type PersistedServerRuntimeState,
  isProcessAlive,
  readPersistedServerRuntimeState,
} from "../serverRuntimeState.ts";

const WELL_KNOWN_ENVIRONMENT_PATH = "/.well-known/t3/environment";
const SERVER_PROBE_TIMEOUT = Duration.millis(2_500);
type ServerStateVariant = "userdata" | "dev";

// deriveServerPaths only checks devUrl for undefined-ness when picking the
// dev-vs-userdata state directory; the value itself is not used.
const DEV_VARIANT_PLACEHOLDER_URL = new URL("http://localhost");

export class NoRunningServerError extends Schema.TaggedError<NoRunningServerError>()(
  "NoRunningServerError",
  {
    checkedStatePaths: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return [
      "No running T3 Code server found.",
      ...this.checkedStatePaths.map((statePath) => `  checked ${statePath}`),
      "Open the T3 Code desktop app, start a server with `npx t3 serve`, or connect this machine with T3 Connect: `npx t3 connect`.",
    ].join("\n");
  }
}

/**
 * Three outcomes, because they drive different decisions: a T3 descriptor
 * (pair with it), nothing answering (safe to configure Tailscale Serve), or
 * something answering that is not a T3 server (do NOT overwrite its mapping).
 */
export type EnvironmentProbeResult =
  | { readonly _tag: "descriptor"; readonly descriptor: ExecutionEnvironmentDescriptor }
  | { readonly _tag: "unreachable" }
  | { readonly _tag: "not-a-t3-server" };

export const probeEnvironmentDescriptor = (
  baseUrl: string,
): Effect.Effect<EnvironmentProbeResult, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(new URL(WELL_KNOWN_ENVIRONMENT_PATH, baseUrl).toString());
    const response = yield* client.execute(request).pipe(
      Effect.timeout(SERVER_PROBE_TIMEOUT),
      // Transport failure or timeout: nothing (reachable) is listening there.
      Effect.mapError(() => ({ _tag: "unreachable" }) as const),
    );
    // Bad-gateway family means a proxy (Tailscale Serve) answered for a
    // backend that is gone — a stale mapping, not a live occupant. Treating
    // it as unreachable lets `t3 pair --tailscale` repair its own mapping
    // after the server's port changed.
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      return { _tag: "unreachable" } as const;
    }
    // Anything else that answered HTTP but not with a valid descriptor is
    // some other service.
    const descriptor = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ExecutionEnvironmentDescriptor)),
      Effect.mapError(() => ({ _tag: "not-a-t3-server" }) as const),
    );
    return { _tag: "descriptor", descriptor } as const;
  }).pipe(Effect.catch((outcome) => Effect.succeed(outcome)));

export interface DiscoveredServer {
  readonly baseDir: string;
  readonly variant: ServerStateVariant;
  readonly state: PersistedServerRuntimeState;
  readonly descriptor: ExecutionEnvironmentDescriptor;
}

export const discoverRunningServer = Effect.fn("discoverRunningServer")(function* (
  explicitBaseDir: string | undefined,
) {
  const bases: Array<string> = [];
  if (explicitBaseDir !== undefined && explicitBaseDir.trim().length > 0) {
    bases.push(yield* resolveBaseDir(explicitBaseDir));
  } else {
    // Same precedence as dev-runner: inside a linked worktree its own `.t3`
    // outranks the shared home, so commands target the worktree's dev server.
    const worktreeHome = yield* resolveWorktreeT3Home(process.cwd());
    if (worktreeHome !== undefined) {
      bases.push(worktreeHome);
    }
    const envHome = yield* Config.string("T3CODE_HOME").pipe(Config.option);
    bases.push(yield* resolveBaseDir(Option.getOrUndefined(envHome)));
  }

  const checkedStatePaths: Array<string> = [];
  for (const baseDir of new Set(bases)) {
    for (const variant of ["userdata", "dev"] as const) {
      const derivedPaths = yield* ServerConfig.deriveServerPaths(
        baseDir,
        variant === "dev" ? DEV_VARIANT_PLACEHOLDER_URL : undefined,
        {},
      );
      const statePath = derivedPaths.serverRuntimeStatePath;
      checkedStatePaths.push(statePath);
      const state = yield* readPersistedServerRuntimeState(statePath);
      if (Option.isNone(state)) {
        continue;
      }
      // The pid check guards against a dead server's state file whose port
      // was since reused by a different server: pairing would then mint a
      // token in the old database while the QR code points at the new server.
      if (!isProcessAlive(state.value.pid)) {
        continue;
      }
      const probed = yield* probeEnvironmentDescriptor(state.value.origin);
      if (probed._tag !== "descriptor") {
        continue;
      }
      return {
        baseDir,
        variant,
        state: state.value,
        descriptor: probed.descriptor,
      } satisfies DiscoveredServer;
    }
  }
  return yield* new NoRunningServerError({ checkedStatePaths });
});

/**
 * Server config pointed at the discovered server's state directory, so the
 * minted token lands in the database the running server reads from. Built by
 * hand rather than through `resolveServerConfig` to keep the dev-vs-userdata
 * choice pinned to where the runtime state was actually found, independent of
 * ambient environment variables.
 */
export const makeDiscoveredServerConfig = Effect.fn(function* (input: {
  readonly target: DiscoveredServer;
  readonly logLevel: ServerConfig.ServerConfig["Service"]["logLevel"];
}) {
  const { baseDir, variant, state } = input.target;
  // The state-dir variant does not imply dev-ness: a worktree dev server uses
  // an explicit home and therefore lands in `userdata`. The recorded devUrl is
  // what actually marks a dev server.
  const devUrl = state.devUrl !== undefined ? new URL(state.devUrl) : undefined;
  const derivedPaths = yield* ServerConfig.deriveServerPaths(
    baseDir,
    variant === "dev" ? DEV_VARIANT_PLACEHOLDER_URL : undefined,
    {},
  );
  return ServerConfig.make({
    logLevel: input.logLevel,
    traceMinLevel: "Info",
    traceTimingEnabled: false,
    traceBatchWindowMs: 1_000,
    traceMaxBytes: 10 * 1024 * 1024,
    traceMaxFiles: 10,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpExportIntervalMs: 10_000,
    otlpServiceName: "t3-server",
    mode: "web",
    port: state.port,
    host: state.host,
    cwd: process.cwd(),
    baseDir,
    ...derivedPaths,
    staticDir: undefined,
    devUrl,
    devAllowedOrigins: [],
    noBrowser: true,
    startupPresentation: "headless",
    desktopBootstrapToken: undefined,
    desktopTelemetryFd: undefined,
    desktopTelemetryControlFd: undefined,
    resourceMonitorPath: undefined,
    autoBootstrapProjectFromCwd: false,
    logWebSocketEvents: false,
    tailscaleServeEnabled: false,
    tailscaleServePort: DEFAULT_TAILSCALE_SERVE_PORT,
  });
});
