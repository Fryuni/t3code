// Pi frames are LF-delimited with trailing CR stripped; readline also splits U+2028/U+2029 and corrupts them.
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import {
  MAX_TOOL_OUTPUT_IMAGES,
  MAX_TOOL_OUTPUT_IMAGE_BASE64_LENGTH,
} from "@t3tools/shared/toolOutput";

import { signalProcessGroup } from "@t3tools/provider-core/server/processGroup";

export class PiRpcError extends Schema.TaggedError<PiRpcError>()("PiRpcError", {
  operation: Schema.String,
  detail: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Pi RPC ${this.operation} failed${this.detail === undefined ? "" : `: ${this.detail}`}.`;
  }
}

export class PiRpcTimeoutError extends Schema.TaggedError<PiRpcTimeoutError>()(
  "PiRpcTimeoutError",
  {
    operation: Schema.String,
    timeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  },
) {
  override get message(): string {
    return `Pi RPC ${this.operation} failed: timed out after ${this.timeoutMs}ms.`;
  }
}

export type PiRpcRecord = Record<string, unknown>;

export function piRecordField(input: unknown, key: string): unknown {
  return Predicate.isObject(input) ? input[key] : undefined;
}

export function piRecordString(input: unknown, key: string): string | undefined {
  const value = piRecordField(input, key);
  return Predicate.isString(value) ? value : undefined;
}

export function piRecordNumber(input: unknown, key: string): number | undefined {
  const value = piRecordField(input, key);
  return Predicate.isNumber(value) && Number.isFinite(value) ? value : undefined;
}

// Pi provider names and model ids may both contain "/", so a slug only splits
// reliably through the `{provider, id}` pairs `get_available_models` reported.
export function findReportedPiModel(
  slug: string,
  reportedModels: unknown,
): { provider: string; modelId: string } | undefined {
  if (!Array.isArray(reportedModels)) return undefined;
  for (const model of reportedModels) {
    const provider = piRecordString(model, "provider");
    const modelId = piRecordString(model, "id");
    if (provider !== undefined && modelId !== undefined && `${provider}/${modelId}` === slug)
      return { provider, modelId };
  }
  return undefined;
}

export function resolvePiModelSlug(
  slug: string,
  reportedModels: unknown,
): { provider: string; modelId: string } | null {
  const reported = findReportedPiModel(slug, reportedModels);
  if (reported !== undefined) return reported;
  const separator = slug.indexOf("/");
  if (separator <= 0 || separator === slug.length - 1) return null;
  return { provider: slug.slice(0, separator), modelId: slug.slice(separator + 1) };
}

export interface PiRpcSpawnOptions {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string | undefined;
  readonly env: NodeJS.ProcessEnv;
}

export interface PiRpcConnection {
  readonly send: (record: PiRpcRecord) => Effect.Effect<void, PiRpcError>;
  readonly request: (
    record: PiRpcRecord,
    timeoutMs?: number,
  ) => Effect.Effect<unknown, PiRpcError | PiRpcTimeoutError>;
  readonly events: Queue.Queue<PiRpcRecord, PiRpcError>;
  readonly exited: Effect.Effect<number, PiRpcError>;
  readonly terminate: Effect.Effect<void>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const TERMINATION_GRACE = Duration.seconds(1);
const TERMINATION_POLL_INTERVAL = Duration.millis(20);

interface PendingPiRequest {
  readonly deferred: Deferred.Deferred<unknown, PiRpcError>;
}

// MCP duplicates images in model content and CallToolResult; budget both plus bounded overhead.
const MAX_PI_RECORD_CHARS =
  2 * MAX_TOOL_OUTPUT_IMAGES * MAX_TOOL_OUTPUT_IMAGE_BASE64_LENGTH + 8 * 1024 * 1024;
const MAX_PI_REASSEMBLED_BYTES = 64 * 1024 * 1024;
const PI_RESPONSE_TRANSPORT_LIMIT_ERROR = "RPC response exceeded the transport limit";

function supportsRpcProtocolV2(record: PiRpcRecord): boolean {
  return (
    record["type"] === "ready" &&
    Array.isArray(record["supportedProtocolVersions"]) &&
    record["supportedProtocolVersions"].includes(2)
  );
}

interface PendingRpcChunk {
  readonly chunkId: string;
  readonly count: number;
  readonly byteLength: number;
  nextIndex: number;
  readonly chunks: Array<Buffer>;
  receivedBytes: number;
}

function makeRpcChunkAssembler() {
  let pending: PendingRpcChunk | undefined;
  const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

  return (record: PiRpcRecord): { readonly record?: PiRpcRecord; readonly warning?: string } => {
    if (record["type"] !== "rpc_chunk") {
      if (pending !== undefined) {
        pending = undefined;
        return { record, warning: "Interrupted pi RPC chunk sequence." };
      }
      return { record };
    }

    const chunkId = piRecordString(record, "chunkId");
    const index = piRecordNumber(record, "index");
    const count = piRecordNumber(record, "count");
    const byteLength = piRecordNumber(record, "byteLength");
    const data = piRecordString(record, "data");
    if (
      chunkId === undefined ||
      chunkId.length === 0 ||
      chunkId.length > 128 ||
      index === undefined ||
      count === undefined ||
      byteLength === undefined ||
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(count) ||
      !Number.isSafeInteger(byteLength) ||
      index < 0 ||
      count < 2 ||
      index >= count ||
      byteLength <= 0 ||
      byteLength > MAX_PI_REASSEMBLED_BYTES ||
      data === undefined ||
      data.length === 0
    ) {
      pending = undefined;
      return { warning: "Dropping invalid pi RPC chunk metadata." };
    }

    const bytes = Buffer.from(data, "base64");
    if (pending === undefined) {
      if (index !== 0) {
        return { warning: "Dropping out-of-order pi RPC chunk." };
      }
      pending = { chunkId, count, byteLength, nextIndex: 0, chunks: [], receivedBytes: 0 };
    }

    if (
      pending.chunkId !== chunkId ||
      pending.count !== count ||
      pending.byteLength !== byteLength ||
      pending.nextIndex !== index
    ) {
      pending = undefined;
      return { warning: "Dropping mismatched pi RPC chunk sequence." };
    }

    pending.chunks.push(bytes);
    pending.receivedBytes += bytes.byteLength;
    pending.nextIndex += 1;
    if (pending.receivedBytes > pending.byteLength) {
      pending = undefined;
      return { warning: "Dropping oversized pi RPC chunk sequence." };
    }
    if (pending.nextIndex < pending.count) {
      return {};
    }

    const completed = pending;
    pending = undefined;
    if (completed.receivedBytes !== completed.byteLength) {
      return { warning: "Dropping truncated pi RPC chunk sequence." };
    }
    try {
      const decoded = utf8Decoder.decode(Buffer.concat(completed.chunks));
      const reassembled = parsePiRecord(decoded);
      if (reassembled === undefined) {
        return { warning: "Dropping undecodable pi RPC chunk payload." };
      }
      return { record: reassembled };
    } catch {
      return { warning: "Dropping undecodable pi RPC chunk payload." };
    }
  };
}

function makeJsonlFramer() {
  let buffer = "";
  let dropping = false;
  return (chunk: string) => {
    const lines: string[] = [];
    const droppedLengths: number[] = [];
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf("\n", start);
      const end = newline < 0 ? chunk.length : newline;
      if (!dropping) {
        if (buffer.length + end - start > MAX_PI_RECORD_CHARS) {
          droppedLengths.push(buffer.length + end - start);
          buffer = "";
          dropping = true;
        } else {
          buffer += chunk.slice(start, end);
        }
      }
      if (newline < 0) break;
      if (!dropping && buffer.length > 0) {
        lines.push(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
      }
      buffer = "";
      dropping = false;
      start = newline + 1;
    }
    return { lines, droppedLengths };
  };
}

// Report the observed length before LF arrives; an unterminated response can time out first.
const logDroppedPiRecords = (droppedLengths: ReadonlyArray<number>) =>
  Effect.forEach(
    droppedLengths,
    (recordLength) =>
      Effect.logWarning("Dropping oversized pi stdout record.", {
        recordLength,
        maxRecordLength: MAX_PI_RECORD_CHARS,
      }),
    { discard: true },
  );

const UnknownFromJsonString = Schema.fromJsonString(Schema.Unknown);
const decodeJsonLine = Schema.decodeSync(UnknownFromJsonString);
const encodeJsonLine = Schema.encodeSync(UnknownFromJsonString);

const PI_ERROR_DETAIL_MAX_CHARS = 200;

function summarizePiError(error: unknown): string {
  const text = typeof error === "string" ? error : JSON.stringify(error);
  if (text === undefined) return "unknown error";
  return text.length > PI_ERROR_DETAIL_MAX_CHARS
    ? `${text.slice(0, PI_ERROR_DETAIL_MAX_CHARS)}…`
    : text;
}

// Pi 0.84+ may exit 1 during import without any protocol output.
function describePiStdoutClosure(exitCode: number | undefined): string {
  if (exitCode === undefined || !Number.isFinite(exitCode)) {
    return "pi process closed stdout";
  }
  return `pi process exited with code ${exitCode}`;
}

function parsePiRecord(line: string): PiRpcRecord | undefined {
  try {
    const parsed: unknown = decodeJsonLine(line);
    return Predicate.isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `hasExited` is consulted before each signal. Once the original child is
 * gone its pid/pgid can be recycled by the OS, so escalating blindly could
 * deliver SIGKILL to an unrelated process.
 */
const terminatePiProcess = Effect.fn("PiRpc.terminatePiProcess")(function* (
  kill: (signal: NodeJS.Signals) => boolean,
  hasExited: () => boolean,
  groupGone: () => boolean,
) {
  if (hasExited()) return;
  if (!kill("SIGTERM")) return;
  yield* Effect.sleep(TERMINATION_POLL_INTERVAL).pipe(
    Effect.repeat({ until: groupGone }),
    Effect.timeoutOption(TERMINATION_GRACE),
  );
  if (hasExited()) return;
  kill("SIGKILL");
});

export const makePiRpcConnection = Effect.fnUntraced(function* (options: PiRpcSpawnOptions) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* HostProcess.Platform;
  const scope = yield* Effect.scope;

  const spawnCommand = yield* resolveSpawnCommand(options.command, [...options.args], {
    env: options.env,
  }).pipe(Effect.mapError((cause) => new PiRpcError({ operation: "spawn", cause })));
  const child = yield* spawner
    .spawn(
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        env: options.env,
        extendEnv: false,
        shell: spawnCommand.shell,
        detached: platform !== "win32",
        // On stdin EOF Pi quits without its SIGTERM handler, so the later SIGTERM kills it mid-cleanup.
        stdin: { stream: "pipe", endOnDone: false },
      }),
    )
    .pipe(Effect.mapError((cause) => new PiRpcError({ operation: "spawn", cause })));

  let childExited = false;
  let diagnosingStdoutClose = false;

  const killProcessGroup = (signal: NodeJS.Signals): boolean => {
    try {
      if (platform === "win32") {
        process.kill(Number(child.pid), signal);
      } else {
        signalProcessGroup(Number(child.pid), signal);
      }
      return true;
    } catch {
      return false;
    }
  };

  const hasExited = (): boolean => {
    if (childExited) return true;
    try {
      if (platform === "win32") process.kill(Number(child.pid), 0);
      else signalProcessGroup(Number(child.pid), 0);
      return false;
    } catch {
      return true;
    }
  };

  // EPERM means a group member is still alive, so only ESRCH ends the SIGTERM grace early.
  const processGroupGone = (): boolean => {
    try {
      signalProcessGroup(Number(child.pid), 0);
      return false;
    } catch (cause) {
      return (cause as NodeJS.ErrnoException | undefined)?.code === "ESRCH";
    }
  };

  // Windows process.kill leaves extension children and pipes alive; taskkill /T reaps the tree.
  const terminateWindowsTree = Effect.gen(function* () {
    if (hasExited()) return;
    const taskkill = yield* spawner.spawn(
      ChildProcess.make("taskkill", ["/PID", String(child.pid), "/T", "/F"]),
    );
    yield* taskkill.exitCode;
  }).pipe(Effect.scoped, Effect.ignore);

  const terminateProcess =
    platform === "win32"
      ? terminateWindowsTree
      : terminatePiProcess(killProcessGroup, hasExited, processGroupGone);

  // Register teardown immediately after spawn so interrupted setup cannot leak a detached process.
  yield* Scope.addFinalizer(scope, terminateProcess.pipe(Effect.ignore, Effect.uninterruptible));

  const pendingRequests = new Map<string, PendingPiRequest>();
  const events = yield* Queue.unbounded<PiRpcRecord, PiRpcError>();
  const outgoing = yield* Queue.unbounded<Uint8Array, PiRpcError>();
  const transportDown = yield* Deferred.make<never, PiRpcError>();
  const exitDeferred = yield* Deferred.make<number, PiRpcError>();
  const assembleChunk = makeRpcChunkAssembler();
  let protocolV2Negotiation: Deferred.Deferred<boolean> | undefined;
  let nextRequestId = 0;

  const failTransport = Effect.fn("PiRpc.failTransport")(function* (error: PiRpcError) {
    const claimed = yield* Deferred.fail(transportDown, error);
    if (!claimed) return;
    for (const [key, pending] of pendingRequests) {
      pendingRequests.delete(key);
      yield* Deferred.fail(pending.deferred, error);
    }
    yield* Queue.fail(outgoing, error);
    yield* Queue.fail(events, error);
  });

  const send =
    /* Protocol records and writes include streaming deltas; avoid a span per record. */
    Effect.fnUntraced(function* (record: PiRpcRecord): Effect.fn.Return<void, PiRpcError> {
      const accepted = yield* Queue.offer(
        outgoing,
        new TextEncoder().encode(`${encodeJsonLine(record)}\n`),
      );
      if (!accepted) {
        return yield* Deferred.await(transportDown);
      }
    });

  const routeRecord =
    /* Protocol records and writes include streaming deltas; avoid a span per record. */
    Effect.fnUntraced(function* (rawRecord: PiRpcRecord) {
      const { record, warning } = assembleChunk(rawRecord);
      if (warning !== undefined) {
        yield* Effect.logWarning(warning);
      }
      if (record === undefined) return;
      if (protocolV2Negotiation === undefined && supportsRpcProtocolV2(record)) {
        const negotiation = yield* Deferred.make<boolean>();
        protocolV2Negotiation = negotiation;
        const id = `t3-${nextRequestId++}`;
        const responseDeferred = yield* Deferred.make<unknown, PiRpcError>();
        pendingRequests.set(id, { deferred: responseDeferred });
        yield* send({ type: "negotiate_protocol", protocolVersion: 2, id }).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              pendingRequests.delete(id);
            }).pipe(Effect.andThen(Deferred.succeed(negotiation, false))),
          ),
        );
        yield* Deferred.await(responseDeferred).pipe(
          Effect.matchEffect({
            onFailure: () => Deferred.succeed(negotiation, false),
            onSuccess: (data) =>
              Deferred.succeed(negotiation, piRecordNumber(data, "protocolVersion") === 2),
          }),
          Effect.forkIn(scope),
        );
      }
      if (record["type"] === "response" && typeof record["id"] === "string") {
        const pending = pendingRequests.get(record["id"]);
        if (pending !== undefined) {
          pendingRequests.delete(record["id"]);
          if (record["success"] === true) {
            yield* Deferred.succeed(pending.deferred, record["data"]);
          } else {
            yield* Deferred.fail(
              pending.deferred,
              new PiRpcError({
                operation: String(record["command"] ?? "request"),
                detail: summarizePiError(record["error"]),
                ...(record["error"] === undefined ? {} : { cause: record["error"] }),
              }),
            );
          }
          return;
        }
      }
      yield* Queue.offer(events, record);
    });

  // Watch exit before reading stdout so immediate crashes populate exitDeferred for diagnosis.
  yield* child.exitCode.pipe(
    Effect.matchEffect({
      onFailure: (cause) =>
        Deferred.fail(exitDeferred, new PiRpcError({ operation: "exit", cause })),
      onSuccess: (code) =>
        Effect.suspend(() => {
          childExited = true;
          return Deferred.succeed(exitDeferred, Number(code));
        }),
    }),
    Effect.forkIn(scope),
  );

  yield* Effect.gen(function* () {
    const frame = makeJsonlFramer();
    yield* child.stdout.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Effect.gen(function* () {
          const { lines, droppedLengths } = frame(chunk);
          yield* logDroppedPiRecords(droppedLengths);
          for (const line of lines) {
            const record = parsePiRecord(line);
            if (record === undefined) {
              yield* Effect.logDebug("Dropping non-JSON pi stdout line.", {
                lineLength: line.length,
              });
              continue;
            }
            yield* routeRecord(record);
          }
        }),
      ),
    );
    const flushed = frame("\n");
    yield* logDroppedPiRecords(flushed.droppedLengths);
    for (const line of flushed.lines) {
      const trailing = parsePiRecord(line);
      if (trailing !== undefined) yield* routeRecord(trailing);
    }
  }).pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) => failTransport(new PiRpcError({ operation: "read", cause })),
      // The enclosing operation owns the span for this inline handler.
      onSuccess: Effect.fnUntraced(function* () {
        // Claim stdout-close diagnosis before waiting so broken stdin cannot replace the exit error.
        diagnosingStdoutClose = true;
        const polled = yield* Deferred.poll(exitDeferred);
        const maybeExitCode = Option.isSome(polled)
          ? yield* polled.value.pipe(
              Effect.asSome,
              Effect.orElseSucceed(() => Option.none<number>()),
            )
          : yield* Deferred.await(exitDeferred).pipe(
              Effect.timeoutOption(Duration.millis(250)),
              // Stdout-close waits need wall time; TestClock would strand Stop-with-restart without an exit.
              Effect.provideService(Clock.Clock, Clock.Clock.defaultValue()),
              Effect.orElseSucceed(() => Option.none<number>()),
            );
        return yield* failTransport(
          new PiRpcError({
            operation: "read",
            detail: describePiStdoutClosure(
              Option.isSome(maybeExitCode) ? maybeExitCode.value : undefined,
            ),
          }),
        );
      }),
    }),
    Effect.forkIn(scope),
  );

  yield* child.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      chunk.trim().length === 0
        ? Effect.void
        : // Log stderr length only; unbounded text may contain credentials or prompts.
          Effect.logDebug("pi stderr", { stderrLength: chunk.length }),
    ),
    Effect.ignore,
    Effect.forkIn(scope),
  );

  // Start the reader first so stdout-close diagnosis can win over broken-pipe stdin.
  yield* Stream.fromQueue(outgoing).pipe(
    Stream.run(child.stdin),
    Effect.catchCause((cause) =>
      diagnosingStdoutClose
        ? Effect.void
        : failTransport(new PiRpcError({ operation: "write", cause })),
    ),
    Effect.forkIn(scope),
  );

  const awaitProtocolV2Negotiation = (
    negotiation: Deferred.Deferred<boolean>,
    operation: string,
    timeoutMs: number,
  ): Effect.Effect<boolean, PiRpcError | PiRpcTimeoutError> =>
    Effect.raceFirst(Deferred.await(negotiation), Deferred.await(transportDown)).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs),
        orElse: () => Effect.fail(new PiRpcTimeoutError({ operation, timeoutMs })),
      }),
    );

  const sendRequestOnce = Effect.fnUntraced(function* (
    record: PiRpcRecord,
    timeoutMs: number,
  ): Effect.fn.Return<unknown, PiRpcError | PiRpcTimeoutError> {
    const id = `t3-${nextRequestId++}`;
    const deferred = yield* Deferred.make<unknown, PiRpcError>();
    pendingRequests.set(id, { deferred });
    yield* send({ ...record, id }).pipe(
      Effect.tapError(() => Effect.sync(() => pendingRequests.delete(id))),
    );
    return yield* Effect.raceFirst(Deferred.await(deferred), Deferred.await(transportDown)).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs),
        orElse: () =>
          Effect.fail(
            new PiRpcTimeoutError({
              operation: String(record["type"] ?? "request"),
              timeoutMs,
            }),
          ),
      }),
      Effect.onInterrupt(() => Effect.sync(() => pendingRequests.delete(id))),
      Effect.onError(() => Effect.sync(() => pendingRequests.delete(id))),
    );
  });

  const request = Effect.fn("PiRpc.request")(function* (
    record: PiRpcRecord,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Effect.fn.Return<unknown, PiRpcError | PiRpcTimeoutError> {
    const operation = String(record["type"] ?? "request");
    const negotiationAtStart = protocolV2Negotiation;
    if (negotiationAtStart !== undefined) {
      yield* awaitProtocolV2Negotiation(negotiationAtStart, operation, timeoutMs);
    }
    return yield* sendRequestOnce(record, timeoutMs).pipe(
      // A first request can reach omp before its `ready` frame triggers v2 negotiation.
      Effect.catchIf(
        (error): error is PiRpcError =>
          negotiationAtStart === undefined &&
          error._tag === "PiRpcError" &&
          error.detail === PI_RESPONSE_TRANSPORT_LIMIT_ERROR &&
          protocolV2Negotiation !== undefined,
        (error) =>
          Effect.gen(function* () {
            const negotiated = yield* awaitProtocolV2Negotiation(
              protocolV2Negotiation!,
              operation,
              timeoutMs,
            );
            if (!negotiated) return yield* error;
            return yield* sendRequestOnce(record, timeoutMs);
          }),
      ),
    );
  });

  return {
    send,
    request,
    events,
    exited: Deferred.await(exitDeferred),
    terminate: failTransport(
      new PiRpcError({ operation: "terminate", detail: "pi process was stopped" }),
    ).pipe(Effect.andThen(terminateProcess), Effect.ignore, Effect.uninterruptible),
  } satisfies PiRpcConnection;
});
