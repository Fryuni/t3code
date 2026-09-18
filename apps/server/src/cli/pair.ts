/**
 * `t3 pair` - mint a pairing token for an already-running server and print it
 * as a QR code, without restarting anything.
 *
 * Discovery reads the `server-runtime.json` a live server persists next to its
 * database, then confirms the process is actually answering by fetching its
 * public environment descriptor. Inside a linked git worktree the worktree's
 * own `.t3` is checked first (matching dev-runner precedence); otherwise the
 * shared T3 home. `--tailscale` publishes the server over Tailscale Serve
 * HTTPS and pairs through the tailnet URL instead.
 */
import { AuthStandardClientScopes, PortSchema } from "@t3tools/contracts";
import {
  buildTailscaleHttpsBaseUrl,
  DEFAULT_TAILSCALE_SERVE_PORT,
  ensureTailscaleServe,
  readTailscaleStatus,
} from "@t3tools/tailscale";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import type { PersistedServerRuntimeState } from "../serverRuntimeState.ts";
import {
  buildPairingUrl,
  formatHostForUrl,
  isLoopbackHost,
  isWildcardHost,
  renderTerminalQrCode,
  resolveHeadlessConnectionString,
} from "../startupAccess.ts";
import { baseDirFlag, DurationFromString } from "./config.ts";
import {
  type DiscoveredServer,
  type EnvironmentProbeResult,
  discoverRunningServer,
  makeDiscoveredServerConfig,
  probeEnvironmentDescriptor,
} from "./runningServer.ts";

// Tailscale can take a few seconds to provision its first HTTPS certificate.
const TAILSCALE_PROBE_ATTEMPTS = 5;
const TAILSCALE_PROBE_RETRY_DELAY = Duration.seconds(1);

// Each tailscale failure gets its own class (same reasoning as
// scripts/lib/dev-share.ts): distinct caller-visible message, distinct remedy.
export class TailscaleUnavailableError extends Schema.TaggedError<TailscaleUnavailableError>()(
  "TailscaleUnavailableError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not talk to Tailscale. Is tailscaled running? Try `tailscale status`.";
  }
}

export class MagicDnsNameMissingError extends Schema.TaggedError<MagicDnsNameMissingError>()(
  "MagicDnsNameMissingError",
  {},
) {
  override get message(): string {
    return "This machine has no MagicDNS name. Run `tailscale up` and enable MagicDNS.";
  }
}

export class ServesOtherEnvironmentError extends Schema.TaggedError<ServesOtherEnvironmentError>()(
  "ServesOtherEnvironmentError",
  { servePort: Schema.Number },
) {
  override get message(): string {
    return `Tailscale Serve on HTTPS port ${String(this.servePort)} already fronts a different T3 Code server. Pass --tailscale-serve-port to publish this one on another port.`;
  }
}

export class TailscaleServeFailedError extends Schema.TaggedError<TailscaleServeFailedError>()(
  "TailscaleServeFailedError",
  { servePort: Schema.Number, cause: Schema.Defect() },
) {
  override get message(): string {
    return `tailscale serve failed for HTTPS port ${String(this.servePort)}. Run \`tailscale serve --https=${String(this.servePort)} --bg <local-url>\` by hand to see why.`;
  }
}

export class ServePortOccupiedError extends Schema.TaggedError<ServePortOccupiedError>()(
  "ServePortOccupiedError",
  { servePort: Schema.Number },
) {
  override get message(): string {
    return `HTTPS port ${String(this.servePort)} on the tailnet already serves something that is not a T3 Code server. Pass --tailscale-serve-port to publish this one on another port.`;
  }
}

/** The URL a browser or phone should pair through, absent Tailscale. */
export const resolveDirectPairingBaseUrl = (state: PersistedServerRuntimeState): string =>
  state.publicUrl ?? state.devUrl ?? resolveHeadlessConnectionString(state.host, state.port);

export class DevServerNotProxiableError extends Schema.TaggedError<DevServerNotProxiableError>()(
  "DevServerNotProxiableError",
  { devUrl: Schema.String },
) {
  override get message(): string {
    return `Tailscale Serve can only proxy plain-HTTP local targets, and this dev server runs at ${this.devUrl}. Pair without --tailscale instead.`;
  }
}

const isDevServerNotProxiableError = Schema.is(DevServerNotProxiableError);

/**
 * The local endpoint Tailscale Serve should proxy to. Dev servers are
 * single-origin, so the web dev server's port is the one to publish; the
 * backend rides along behind Vite's proxy. Serve targets are always plain
 * HTTP, so an HTTPS dev URL cannot be proxied and is rejected.
 */
export const resolveTailscaleLocalTarget = (
  state: PersistedServerRuntimeState,
): { readonly localPort: number; readonly localHost?: string } | DevServerNotProxiableError => {
  if (state.devUrl !== undefined) {
    const devUrl = new URL(state.devUrl);
    if (devUrl.protocol !== "http:") {
      return new DevServerNotProxiableError({ devUrl: state.devUrl });
    }
    const localPort = devUrl.port.length > 0 ? Number.parseInt(devUrl.port, 10) : 80;
    return isLoopbackHost(devUrl.hostname)
      ? { localPort }
      : { localPort, localHost: devUrl.hostname };
  }
  // A server bound to one specific interface does not answer on loopback, so
  // the proxy has to target that interface directly.
  if (state.host !== undefined && !isWildcardHost(state.host) && !isLoopbackHost(state.host)) {
    return { localPort: state.port, localHost: formatHostForUrl(state.host) };
  }
  return { localPort: state.port };
};

const formatPairOutput = (input: {
  readonly serverLabel: string;
  readonly origin: string;
  readonly pairingUrl: string;
  readonly token: string;
  readonly expiresAt: DateTime.Utc;
  readonly notes: ReadonlyArray<string>;
}): string =>
  [
    `Pairing with ${input.serverLabel} (${input.origin}).`,
    "",
    renderTerminalQrCode(input.pairingUrl),
    "",
    `Pairing URL: ${input.pairingUrl}`,
    `Token: ${input.token}`,
    `Expires: ${DateTime.formatIso(input.expiresAt)}`,
    ...input.notes.flatMap((note) => ["", `Note: ${note}`]),
    "",
  ].join("\n");

const awaitEnvironmentDescriptor = Effect.fn(function* (baseUrl: string) {
  let last: EnvironmentProbeResult = { _tag: "unreachable" };
  for (let attempt = 0; attempt < TAILSCALE_PROBE_ATTEMPTS; attempt += 1) {
    last = yield* probeEnvironmentDescriptor(baseUrl);
    if (last._tag === "descriptor") {
      return last;
    }
    yield* Effect.sleep(TAILSCALE_PROBE_RETRY_DELAY);
  }
  return last;
});

const resolveTailscalePairingBase = Effect.fn("pair.resolveTailscalePairingBase")(
  function* (input: { readonly target: DiscoveredServer; readonly servePort: number }) {
    const notes: Array<string> = [];
    const status = yield* readTailscaleStatus.pipe(
      Effect.mapError((cause) => new TailscaleUnavailableError({ cause })),
    );
    if (status.magicDnsName === null) {
      return yield* new MagicDnsNameMissingError();
    }
    const baseUrl = buildTailscaleHttpsBaseUrl({
      magicDnsName: status.magicDnsName,
      servePort: input.servePort,
    });

    // Only an unreachable port, or a mapping already fronting this exact
    // environment, is safe to (re)configure. Any other responder — T3 or not
    // — must not have its mapping silently replaced.
    const existing = yield* probeEnvironmentDescriptor(baseUrl);
    if (existing._tag === "descriptor") {
      if (existing.descriptor.environmentId !== input.target.descriptor.environmentId) {
        return yield* new ServesOtherEnvironmentError({ servePort: input.servePort });
      }
      // Matching environment id proves the mapping reaches this server, but
      // not through which port: for a dev server it may front the backend
      // (whose /.well-known also answers) while /pair only renders through
      // the web origin. Reuse as-is for regular servers; fall through and
      // repoint our own mapping at the web port for dev servers.
      if (input.target.state.devUrl === undefined) {
        return { baseUrl, notes };
      }
    }
    if (existing._tag === "not-a-t3-server") {
      return yield* new ServePortOccupiedError({ servePort: input.servePort });
    }

    const localTarget = resolveTailscaleLocalTarget(input.target.state);
    if (isDevServerNotProxiableError(localTarget)) {
      return yield* localTarget;
    }
    yield* ensureTailscaleServe({
      localPort: localTarget.localPort,
      servePort: input.servePort,
      ...(localTarget.localHost !== undefined ? { localHost: localTarget.localHost } : {}),
    }).pipe(
      Effect.mapError(
        (cause) => new TailscaleServeFailedError({ servePort: input.servePort, cause }),
      ),
    );
    notes.push(
      `Tailscale Serve now maps ${baseUrl} to this server and persists across restarts. Remove it with \`tailscale serve --https=${String(input.servePort)} off\`.`,
    );

    const probed = yield* awaitEnvironmentDescriptor(baseUrl);
    if (probed._tag === "descriptor") {
      if (probed.descriptor.environmentId !== input.target.descriptor.environmentId) {
        return yield* new ServesOtherEnvironmentError({ servePort: input.servePort });
      }
    } else {
      notes.push(
        "The HTTPS endpoint has not answered yet. First use can take a moment while Tailscale provisions certificates.",
      );
    }
    return { baseUrl, notes };
  },
);

const mintPairingLink = Effect.fn("pair.mintPairingLink")(function* (input: {
  readonly config: ServerConfig.ServerConfig["Service"];
  readonly ttl: Option.Option<Duration.Duration>;
  readonly label: Option.Option<string>;
}) {
  return yield* Effect.gen(function* () {
    const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
    return yield* environmentAuth.createPairingLink({
      scopes: AuthStandardClientScopes,
      subject: "one-time-token",
      label: Option.getOrElse(input.label, () => "t3 pair"),
      ...(Option.isSome(input.ttl) ? { ttl: input.ttl.value } : {}),
    });
  }).pipe(
    Effect.provide(
      EnvironmentAuth.runtimeLayer.pipe(
        Layer.provide(ServerConfig.layer(input.config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, input.config.logLevel)),
      ),
    ),
  );
});

const ttlFlag = Flag.String("ttl").pipe(
  Flag.withSchema(DurationFromString),
  Flag.withDescription(
    "Token TTL, for example `5m`, `1h`, or `15 minutes`. Defaults to 5 minutes.",
  ),
  Flag.optional,
);

const labelFlag = Flag.String("label").pipe(
  Flag.withDescription("Optional label shown in the server's connections list."),
  Flag.optional,
);

const tailscaleFlag = Flag.Boolean("tailscale").pipe(
  Flag.withDescription(
    "Publish the server over Tailscale Serve HTTPS and pair through the tailnet URL.",
  ),
  Flag.withDefault(false),
);

const tailscaleServePortFlag = Flag.Int("tailscale-serve-port").pipe(
  Flag.withSchema(PortSchema),
  Flag.withDescription("HTTPS port for Tailscale Serve when --tailscale is enabled."),
  Flag.withDefault(DEFAULT_TAILSCALE_SERVE_PORT),
);

export const pairCommand = Command.make("pair", {
  baseDir: baseDirFlag,
  ttl: ttlFlag,
  label: labelFlag,
  tailscale: tailscaleFlag,
  tailscaleServePort: tailscaleServePortFlag,
}).pipe(
  Command.withDescription(
    "Mint a pairing token for a running T3 Code server and print it as a QR code.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const cliLogLevel = yield* GlobalFlag.LogLevel;
      // Default to Warn so storage/migration chatter cannot bury the QR code;
      // an explicit --log-level still wins.
      const logLevel = Option.getOrElse(cliLogLevel, () => "Warn" as const);

      const target = yield* discoverRunningServer(Option.getOrUndefined(flags.baseDir));

      const notes: Array<string> = [];
      let pairingBaseUrl: string;
      if (flags.tailscale) {
        const resolved = yield* resolveTailscalePairingBase({
          target,
          servePort: flags.tailscaleServePort,
        });
        pairingBaseUrl = resolved.baseUrl;
        notes.push(...resolved.notes);
      } else {
        pairingBaseUrl = resolveDirectPairingBaseUrl(target.state);
        if (isLoopbackHost(new URL(pairingBaseUrl).hostname)) {
          notes.push(
            "This URL is only reachable from this machine. Re-run with --tailscale, or restart the server with a reachable --host or --public-url for an external proxy.",
          );
        }
        if (target.variant === "dev" && target.state.devUrl === undefined) {
          notes.push(
            "This dev server did not record its web URL; restart it so pairing can go through the web origin.",
          );
        }
      }

      const config = yield* makeDiscoveredServerConfig({ target, logLevel });
      const issued = yield* mintPairingLink({ config, ttl: flags.ttl, label: flags.label });
      const pairingUrl = buildPairingUrl(pairingBaseUrl, issued.credential);

      yield* Console.log(
        formatPairOutput({
          serverLabel: target.descriptor.label,
          origin: target.state.origin,
          pairingUrl,
          token: issued.credential,
          expiresAt: issued.expiresAt,
          notes,
        }),
      );
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  ),
);
