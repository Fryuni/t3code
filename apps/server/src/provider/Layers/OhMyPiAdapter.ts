/**
 * OhMyPiAdapterLive — OhMyPi CLI (`omp acp`) via ACP.
 *
 * @module OhMyPiAdapterLive
 */

import {
  ApprovalRequestId,
  type OhMyPiSettings,
  type ProviderOptionSelection,
  EventId,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeTaskId,
  RuntimeRequestId,
  type RuntimeMode,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { buildRuntimeInstructions } from "../RuntimeInstructions.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { mapAcpToAdapterError } from "../acp/AcpAdapterSupport.ts";
import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents.ts";
import { parsePermissionRequest } from "../acp/AcpRuntimeModel.ts";
import { makeAcpNativeLoggerFactory } from "../acp/AcpNativeLogging.ts";
import {
  applyOhMyPiAcpModelSelection,
  makeOhMyPiAcpRuntime,
  selectOhMyPiPermissionOption,
} from "../acp/OhMyPiAcpSupport.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { ProviderAdapterError } from "../Errors.ts";
type OhMyPiAdapterShape = ProviderAdapterShape<ProviderAdapterError>;
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
const encodeUnknownJsonStringExit = Schema.encodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

const PROVIDER = ProviderDriverKind.make("ohMyPi");
const OH_MY_PI_RESUME_VERSION = 1 as const;
function encodeJsonStringForDiagnostics(input: unknown): string | undefined {
  const result = encodeUnknownJsonStringExit(input);
  return Exit.isSuccess(result) ? result.value : undefined;
}

export interface OhMyPiAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  /**
   * Selections are honored when `modelSelection.instanceId` matches this value.
   * Defaults to the legacy built-in instance id (`ohMyPi`).
   */
  readonly instanceId?: ProviderInstanceId;
  readonly onAvailableCommands?: (
    commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
    cwd: string,
  ) => Effect.Effect<void>;
}

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
  readonly kind: string | "unknown";
}

interface OhMyPiChildTaskState {
  readonly taskId: RuntimeTaskId;
  readonly turnId: TurnId | undefined;
  readonly toolUseId: string;
  readonly title: string;
  readonly role: string;
  started: boolean;
  terminal: boolean;
  fingerprint: string | undefined;
}

interface OhMyPiTaskEntry {
  readonly id: string;
  readonly index: number | undefined;
  readonly status: string | undefined;
  readonly agent: string | undefined;
  readonly task: string | undefined;
  readonly assignment: string | undefined;
  readonly description: string | undefined;
  readonly lastIntent: string | undefined;
  readonly currentTool: string | undefined;
  readonly model: string | undefined;
  readonly effort: string | undefined;
  readonly tokens: number | undefined;
  readonly toolCount: number | undefined;
  readonly durationMs: number | undefined;
  readonly output: string | undefined;
  readonly stderr: string | undefined;
  readonly error: string | undefined;
  readonly aborted: boolean;
  readonly abortReason: string | undefined;
  readonly exitCode: number | undefined;
}

interface OhMyPiTaskSnapshot {
  readonly progress: ReadonlyArray<OhMyPiTaskEntry>;
  readonly results: ReadonlyArray<OhMyPiTaskEntry>;
}

interface OhMyPiObservedTaskUpdate {
  readonly toolCallId: string;
  readonly snapshot: OhMyPiTaskSnapshot;
  readonly inputs: ReadonlyArray<Record<string, unknown>>;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= 8_000
    ? trimmed
    : `[Earlier output truncated]\n\n${trimmed.slice(-7_970)}`;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOhMyPiTaskEntry(value: unknown): OhMyPiTaskEntry | undefined {
  if (!isUnknownRecord(value)) return undefined;
  const id = nonEmptyString(value.id);
  if (id === undefined) return undefined;
  const index = nonNegativeInteger(value.index);
  const status = nonEmptyString(value.status);
  const agent = nonEmptyString(value.agent);
  // Entry fields are validated only after their container has established the
  // native TaskTool envelope (or an explicit eval/hub agent marker).
  const exitCode = typeof value.exitCode === "number" ? value.exitCode : undefined;
  if (agent === undefined || (status === undefined && exitCode === undefined)) return undefined;
  return {
    id,
    index,
    status,
    agent,
    task: nonEmptyString(value.task),
    assignment: nonEmptyString(value.assignment),
    description: nonEmptyString(value.description),
    lastIntent: nonEmptyString(value.lastIntent),
    currentTool: nonEmptyString(value.currentTool),
    tokens: nonNegativeInteger(value.tokens),
    toolCount: nonNegativeInteger(value.toolCount),
    model: nonEmptyString(value.resolvedModel) ?? nonEmptyString(value.modelOverride),
    effort: nonEmptyString(value.resolvedThinkingLevel),
    durationMs: nonNegativeInteger(value.durationMs),
    output: nonEmptyString(value.output),
    stderr: nonEmptyString(value.stderr),
    error: nonEmptyString(value.error),
    aborted: value.aborted === true,
    abortReason: nonEmptyString(value.abortReason),
    exitCode,
  };
}
function isOhMyPiTaskToolDetails(value: Record<string, unknown>): value is Record<
  string,
  unknown
> & {
  readonly projectAgentsDir: string | null;
  readonly totalDurationMs: number;
  readonly results: ReadonlyArray<unknown>;
} {
  return (
    (value.projectAgentsDir === null || typeof value.projectAgentsDir === "string") &&
    nonNegativeNumber(value.totalDurationMs) !== undefined &&
    Array.isArray(value.results)
  );
}
function parseOhMyPiTaskSnapshot(rawOutput: unknown): OhMyPiTaskSnapshot | undefined {
  if (!isUnknownRecord(rawOutput)) return undefined;
  const details = isUnknownRecord(rawOutput.details) ? rawOutput.details : rawOutput;
  const isTaskTool = isOhMyPiTaskToolDetails(details);
  const progressValues = isTaskTool && Array.isArray(details.progress) ? details.progress : [];
  const resultValues = isTaskTool ? details.results : [];
  const statusValues = Array.isArray(details.statusEvents)
    ? details.statusEvents.filter((value) => isUnknownRecord(value) && value.op === "agent")
    : [];
  const jobValues =
    (details.op === "wait" || details.op === "jobs" || details.op === "cancel") &&
    Array.isArray(details.jobs)
      ? details.jobs
          .filter((value) => isUnknownRecord(value) && value.type === "task")
          .map((value) => ({
            ...value,
            id: nonEmptyString(value.agentUrlId) ?? value.id,
            agent: nonEmptyString(value.type) ?? "task",
            task: nonEmptyString(value.label),
            output: nonEmptyString(value.resultText),
            error: nonEmptyString(value.errorText),
            status: value.status === "cancelled" ? "aborted" : value.status,
          }))
      : [];
  const progress = [...progressValues, ...statusValues, ...jobValues].flatMap((candidate) => {
    const value =
      isUnknownRecord(candidate) && candidate.op === "agent"
        ? {
            ...candidate,
            agent: nonEmptyString(candidate.role) ?? "agent",
            task: nonEmptyString(candidate.taskPreview),
            resolvedModel: candidate.resolvedModelIdentity ?? candidate.resolvedModel,
          }
        : candidate;
    const parsed = parseOhMyPiTaskEntry(value);
    return parsed ? [parsed] : [];
  });
  const results = resultValues.flatMap((value) => {
    const parsed = parseOhMyPiTaskEntry(value);
    return parsed ? [parsed] : [];
  });
  return progress.length > 0 || results.length > 0 ? { progress, results } : undefined;
}

function ohMyPiTaskInputs(rawInput: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!isUnknownRecord(rawInput)) return [];
  const values = Array.isArray(rawInput.tasks)
    ? rawInput.tasks.filter(isUnknownRecord)
    : nonEmptyString(rawInput.task)
      ? [rawInput]
      : [];
  return values.map((value) => {
    const id = nonEmptyString(value.id);
    const name = nonEmptyString(value.name);
    const agent = nonEmptyString(value.agent);
    return {
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
      ...(agent ? { agent } : {}),
    };
  });
}

function boundedTaskText(value: string): string {
  return value.length <= 8_000 ? value : `[Earlier output truncated]\n\n${value.slice(-7_970)}`;
}

function taskInputFor(
  inputs: ReadonlyArray<Record<string, unknown>>,
  entry: OhMyPiTaskEntry,
): Record<string, unknown> | undefined {
  return (
    inputs.find((input) => nonEmptyString(input.id) === entry.id) ??
    (entry.index !== undefined ? inputs[entry.index] : undefined)
  );
}

function childTaskStatus(
  entry: OhMyPiTaskEntry,
): "pending" | "running" | "completed" | "failed" | "stopped" {
  if (entry.aborted || entry.status === "aborted" || entry.status === "cancelled") return "stopped";
  if (entry.status === "failed" || (entry.exitCode !== undefined && entry.exitCode !== 0))
    return "failed";
  if (entry.status === "completed" || entry.exitCode === 0) return "completed";
  return entry.status === "pending" ? "pending" : "running";
}

interface OhMyPiSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntime.AcpSessionRuntime["Service"];
  readonly childTasks: Map<string, OhMyPiChildTaskState>;
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  lastPlanFingerprint: string | undefined;
  activeTurnId: TurnId | undefined;
  /** Number of sendTurn prompts currently in flight or being prepared.
   * >0 means a turn is actively running, so a new sendTurn is a steer that
   * continues it, and only the last remaining prompt settles the turn. */
  promptsInFlight: number;
  interruptionVersion: number;
  stopped: boolean;
}

function settlePendingApprovalsAsCancelled(
  pendingApprovals: ReadonlyMap<ApprovalRequestId, PendingApproval>,
): Effect.Effect<void> {
  const pendingEntries = Array.from(pendingApprovals.values());
  return Effect.forEach(
    pendingEntries,
    (pending) => Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore),
    {
      discard: true,
    },
  );
}

const ResumeCursor = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sessionId: Schema.NonEmptyString,
});

const decodeResumeCursor = Schema.decodeUnknownOption(ResumeCursor);

function parseOhMyPiResume(raw: unknown): { sessionId: string } | undefined {
  return Option.getOrUndefined(decodeResumeCursor(raw));
}

function applyRequestedSessionConfiguration<E>(input: {
  readonly runtime: AcpSessionRuntime.AcpSessionRuntime["Service"];
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly modelSelection:
    | {
        readonly model: string;
        readonly options?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
      }
    | undefined;
  readonly mapError: (context: {
    readonly cause: import("effect-acp/errors").AcpError;
    readonly method: "session/set_config_option" | "session/set_mode";
  }) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    if (input.modelSelection) {
      yield* applyOhMyPiAcpModelSelection({
        runtime: input.runtime,
        model: input.modelSelection.model,
        selections: input.modelSelection.options,
        mapError: ({ cause }) =>
          input.mapError({
            cause,
            method: "session/set_config_option",
          }),
      });
    }

    const requestedModeId = input.interactionMode === "plan" ? "plan" : "default";
    const modes = yield* input.runtime.getModeState;
    if (!modes?.availableModes.some((mode) => mode.id === requestedModeId)) return;

    yield* input.runtime.setMode(requestedModeId).pipe(
      Effect.mapError((cause) =>
        input.mapError({
          cause,
          method: "session/set_mode",
        }),
      ),
    );
  });
}

function selectAutoApprovedPermissionOption(
  request: EffectAcpSchema.RequestPermissionRequest,
): string | undefined {
  const allowAlwaysOption = request.options.find((option) => option.kind === "allow_always");
  if (typeof allowAlwaysOption?.optionId === "string" && allowAlwaysOption.optionId.trim()) {
    return allowAlwaysOption.optionId.trim();
  }

  const allowOnceOption = request.options.find((option) => option.kind === "allow_once");
  if (typeof allowOnceOption?.optionId === "string" && allowOnceOption.optionId.trim()) {
    return allowOnceOption.optionId.trim();
  }

  return undefined;
}

export function makeOhMyPiAdapter(
  ohMyPiSettings: OhMyPiSettings,
  options?: OhMyPiAdapterLiveOptions,
) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("ohMyPi");
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const serverConfig = yield* Effect.service(ServerConfig);
    const crypto = yield* Crypto.Crypto;
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
            stream: "native",
          })
        : undefined);
    const managedNativeEventLogger =
      options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;
    const makeAcpNativeLoggers = yield* makeAcpNativeLoggerFactory();

    const sessions = new Map<ThreadId, OhMyPiSessionContext>();
    const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUUIDv4 = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate OhMyPi runtime identifier.",
            cause,
          }),
      ),
    );
    const nextEventId = Effect.map(randomUUIDv4, (id) => EventId.make(id));
    const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });
    const mapExtensionFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new EffectAcpErrors.AcpTransportError({
              detail: "Failed to process OhMyPi ACP extension event.",
              cause,
            }),
        ),
      );

    const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
      PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);
    const emitOhMyPiChildTaskEvents = Effect.fn("OhMyPiAdapter.emitChildTaskEvents")(function* (
      ctx: OhMyPiSessionContext,
      observed: OhMyPiObservedTaskUpdate,
    ) {
      const { snapshot, inputs } = observed;
      const entriesById = new Map<string, OhMyPiTaskEntry>();
      for (const entry of snapshot.progress) entriesById.set(entry.id, entry);
      for (const result of snapshot.results) entriesById.set(result.id, result);

      for (const entry of entriesById.values()) {
        const stateKey = entry.id;
        const input = taskInputFor(inputs, entry);
        const candidateTitle = boundedTaskText(
          nonEmptyString(input?.name) ??
            entry.description ??
            entry.assignment ??
            entry.task ??
            entry.id,
        );
        const candidateRole = nonEmptyString(input?.agent) ?? entry.agent ?? "task";
        const taskId = RuntimeTaskId.make(entry.id);
        const existing = ctx.childTasks.get(stateKey);
        const state: OhMyPiChildTaskState = existing ?? {
          taskId,
          turnId: ctx.activeTurnId,
          toolUseId: observed.toolCallId,
          title: candidateTitle,
          role: candidateRole,
          started: false,
          terminal: false,
          fingerprint: undefined,
        };
        ctx.childTasks.set(stateKey, state);
        const title = state.title;
        const role = state.role;
        const linkage = {
          taskId: state.taskId,
          taskType: "local_agent",
          toolUseId: state.toolUseId,
          title,
          role,
          ...(entry.model ? { model: entry.model } : {}),
          ...(entry.effort ? { effort: entry.effort } : {}),
          timelineBypass: true,
        } as const;
        if (!state.started) {
          yield* offerRuntimeEvent({
            type: "task.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: ctx.threadId,
            turnId: state.turnId,
            payload: {
              ...linkage,
              description: entry.assignment ?? entry.task ?? entry.description ?? title,
            },
          });
          state.started = true;
        }
        // A later result can enrich a terminal progress snapshot with final output/usage.

        const status = childTaskStatus(entry);
        if (
          state.terminal &&
          status !== "completed" &&
          status !== "failed" &&
          status !== "stopped"
        ) {
          continue;
        }
        const terminal = status === "completed" || status === "failed" || status === "stopped";
        const terminalSummary = entry.abortReason ?? entry.error ?? entry.output ?? entry.stderr;
        const fallbackSummary = boundedTaskText(
          entry.lastIntent ??
            entry.currentTool ??
            entry.description ??
            entry.assignment ??
            entry.task ??
            title,
        );
        const summary = terminal
          ? terminalSummary && boundedTaskText(terminalSummary)
          : fallbackSummary;
        const typedUsage =
          entry.tokens !== undefined
            ? {
                totalTokens: entry.tokens,
                ...(entry.toolCount !== undefined ? { toolUses: entry.toolCount } : {}),
                ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
              }
            : undefined;
        const fingerprint = [
          status,
          summary ?? "",
          entry.currentTool ?? "",
          entry.tokens ?? "",
          entry.toolCount ?? "",
          entry.durationMs ?? "",
          entry.model ?? "",
          entry.effort ?? "",
        ].join("\u001f");
        if (state.fingerprint === fingerprint) continue;
        state.fingerprint = fingerprint;
        if (terminal) {
          yield* offerRuntimeEvent({
            type: "task.completed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: ctx.threadId,
            turnId: state.turnId,
            payload: {
              ...linkage,
              status,
              ...(summary ? { summary } : {}),
              ...(typedUsage ? { typedUsage } : {}),
            },
          });
          state.terminal = true;
          continue;
        }
        yield* offerRuntimeEvent({
          type: "task.progress",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          turnId: state.turnId,
          payload: {
            ...linkage,
            description: fallbackSummary,
            summary: fallbackSummary,
            status,
            ...(entry.currentTool ? { lastToolName: entry.currentTool } : {}),
            ...(typedUsage ? { typedUsage } : {}),
          },
        });
      }
    });

    const settleActiveChildTasks = Effect.fn("OhMyPiAdapter.settleActiveChildTasks")(function* (
      ctx: OhMyPiSessionContext,
      summary: string,
    ) {
      for (const state of ctx.childTasks.values()) {
        if (state.terminal) continue;
        yield* offerRuntimeEvent({
          type: "task.completed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          turnId: state.turnId,
          payload: {
            taskId: state.taskId,
            taskType: "local_agent",
            toolUseId: state.toolUseId,
            title: state.title,
            role: state.role,
            timelineBypass: true,
            status: "stopped",
            summary,
          },
        });
        state.terminal = true;
      }
    });

    const getThreadSemaphore = (threadId: string) =>
      SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
        const existing: Option.Option<Semaphore.Semaphore> = Option.fromNullishOr(
          current.get(threadId),
        );
        return Option.match(existing, {
          onNone: () =>
            Semaphore.make(1).pipe(
              Effect.map((semaphore) => {
                const next = new Map(current);
                next.set(threadId, semaphore);
                return [semaphore, next] as const;
              }),
            ),
          onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
        });
      });

    const withThreadLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));

    const logNative = (
      threadId: ThreadId,
      method: string,
      payload: unknown,
      _source: "acp.jsonrpc",
    ) =>
      Effect.gen(function* () {
        if (!nativeEventLogger) return;
        const observedAt = yield* nowIso;
        yield* nativeEventLogger.write(
          {
            observedAt,
            event: {
              id: yield* randomUUIDv4,
              kind: "notification",
              provider: PROVIDER,
              createdAt: observedAt,
              method,
              threadId,
              payload,
            },
          },
          threadId,
        );
      });

    const emitPlanUpdate = (
      ctx: OhMyPiSessionContext,
      payload: {
        readonly explanation?: string | null;
        readonly plan: ReadonlyArray<{
          readonly step: string;
          readonly status: "pending" | "inProgress" | "completed";
        }>;
      },
      rawPayload: unknown,
      source: "acp.jsonrpc",
      method: string,
    ) =>
      Effect.gen(function* () {
        const fingerprint = `${ctx.activeTurnId ?? "no-turn"}:${encodeJsonStringForDiagnostics(payload) ?? "[unserializable payload]"}`;
        if (ctx.lastPlanFingerprint === fingerprint) {
          return;
        }
        ctx.lastPlanFingerprint = fingerprint;
        yield* offerRuntimeEvent(
          makeAcpPlanUpdatedEvent({
            stamp: yield* makeEventStamp(),
            provider: PROVIDER,
            threadId: ctx.threadId,
            turnId: ctx.activeTurnId,
            payload,
            source,
            method,
            rawPayload,
          }),
        );
      });

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<OhMyPiSessionContext, ProviderAdapterSessionNotFoundError> => {
      const ctx = sessions.get(threadId);
      if (!ctx || ctx.stopped || ctx.session.status === "error") {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }),
        );
      }
      return Effect.succeed(ctx);
    };

    const stopSessionInternal = (ctx: OhMyPiSessionContext) =>
      Effect.gen(function* () {
        if (ctx.stopped) return;
        ctx.stopped = true;
        yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
        if (ctx.notificationFiber) {
          yield* Fiber.interrupt(ctx.notificationFiber);
        }
        yield* Effect.ignore(Scope.close(ctx.scope, Exit.void));
        yield* settleActiveChildTasks(ctx, "Provider session stopped");
        sessions.delete(ctx.threadId);
        yield* offerRuntimeEvent({
          type: "session.exited",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          payload: { exitKind: "graceful" },
        });
      });

    const startSession: OhMyPiAdapterShape["startSession"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          if (input.provider !== undefined && input.provider !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
            });
          }
          if (!input.cwd?.trim()) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "cwd is required and must be non-empty.",
            });
          }

          const cwd = path.resolve(input.cwd.trim());
          const ohMyPiModelSelection =
            input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) {
            yield* stopSessionInternal(existing);
          }

          const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
          const pendingObservedToolCalls: OhMyPiObservedTaskUpdate[] = [];
          const sessionScope = yield* Scope.make("sequential");
          let sessionScopeTransferred = false;
          yield* Effect.addFinalizer(() =>
            sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
          );
          let ctx!: OhMyPiSessionContext;

          const resumeSessionId = parseOhMyPiResume(input.resumeCursor)?.sessionId;
          const acpNativeLoggers = makeAcpNativeLoggers({
            nativeEventLogger,
            provider: PROVIDER,
            threadId: input.threadId,
          });

          const mcpSession = McpProviderSession.readMcpProviderSession(input.threadId);
          const acp = yield* makeOhMyPiAcpRuntime({
            ohMyPiSettings,
            environment: {
              ...McpProviderSession.withAgentDeviceEnvironment(
                options?.environment ?? process.env,
                mcpSession,
              ),
              T3CODE_THREAD_ID: input.threadId,
            },
            childProcessSpawner,
            cwd,
            runtimeMode: input.runtimeMode,
            observeToolCallUpdate: (toolCall) =>
              mapExtensionFailure(
                Effect.suspend(() => {
                  const snapshot = parseOhMyPiTaskSnapshot(toolCall.data.rawOutput);
                  if (snapshot === undefined) return Effect.void;
                  const observed = {
                    toolCallId: toolCall.toolCallId,
                    snapshot,
                    inputs: ohMyPiTaskInputs(toolCall.data.rawInput),
                  } satisfies OhMyPiObservedTaskUpdate;
                  if (ctx === undefined) {
                    pendingObservedToolCalls.push(observed);
                    return Effect.void;
                  }
                  return emitOhMyPiChildTaskEvents(ctx, observed);
                }),
              ),
            ...(resumeSessionId ? { resumeSessionId } : {}),
            clientInfo: { name: "t3-code", version: "0.0.0" },
            ...(mcpSession
              ? {
                  mcpServers: [
                    {
                      type: "http" as const,
                      name: "t3-code",
                      url: mcpSession.endpoint,
                      headers: [
                        {
                          name: "Authorization",
                          value: mcpSession.authorizationHeader,
                        },
                      ],
                    },
                  ],
                }
              : {}),
            ...acpNativeLoggers,
          }).pipe(
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.provideService(Scope.Scope, sessionScope),
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: cause.message,
                  cause,
                }),
            ),
          );
          const started = yield* Effect.gen(function* () {
            yield* acp.handleRequestPermission((params) =>
              mapExtensionFailure(
                Effect.gen(function* () {
                  yield* logNative(
                    input.threadId,
                    "session/request_permission",
                    params,
                    "acp.jsonrpc",
                  );
                  if (input.runtimeMode === "full-access") {
                    const autoApprovedOptionId = selectAutoApprovedPermissionOption(params);
                    if (autoApprovedOptionId !== undefined) {
                      return {
                        outcome: {
                          outcome: "selected" as const,
                          optionId: autoApprovedOptionId,
                        },
                      };
                    }
                  }
                  const permissionRequest = parsePermissionRequest(params);
                  const requestId = ApprovalRequestId.make(yield* randomUUIDv4);
                  const runtimeRequestId = RuntimeRequestId.make(requestId);
                  const decision = yield* Deferred.make<ProviderApprovalDecision>();
                  pendingApprovals.set(requestId, {
                    decision,
                    kind: permissionRequest.kind,
                  });
                  yield* offerRuntimeEvent(
                    makeAcpRequestOpenedEvent({
                      stamp: yield* makeEventStamp(),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId: ctx?.activeTurnId,
                      requestId: runtimeRequestId,
                      permissionRequest,
                      detail:
                        permissionRequest.detail ??
                        encodeJsonStringForDiagnostics(params)?.slice(0, 2000) ??
                        "[unserializable params]",
                      args: params,
                      source: "acp.jsonrpc",
                      method: "session/request_permission",
                      rawPayload: params,
                    }),
                  );
                  const resolved = yield* Deferred.await(decision);
                  pendingApprovals.delete(requestId);
                  yield* offerRuntimeEvent(
                    makeAcpRequestResolvedEvent({
                      stamp: yield* makeEventStamp(),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId: ctx?.activeTurnId,
                      requestId: runtimeRequestId,
                      permissionRequest,
                      decision: resolved,
                    }),
                  );
                  const optionId = selectOhMyPiPermissionOption(params, resolved);
                  return {
                    outcome:
                      optionId === undefined
                        ? ({ outcome: "cancelled" } as const)
                        : {
                            outcome: "selected" as const,
                            optionId,
                          },
                  };
                }),
              ),
            );
            return yield* acp.start();
          }).pipe(
            Effect.mapError((error) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, "session/start", error),
            ),
          );

          yield* applyRequestedSessionConfiguration({
            runtime: acp,
            runtimeMode: input.runtimeMode,
            interactionMode: undefined,
            modelSelection: ohMyPiModelSelection,
            mapError: ({ cause, method }) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, method, cause),
          });

          const now = yield* nowIso;
          const session: ProviderSession = {
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            status: "ready",
            runtimeMode: input.runtimeMode,
            cwd,
            model: ohMyPiModelSelection?.model,
            threadId: input.threadId,
            resumeCursor: {
              schemaVersion: OH_MY_PI_RESUME_VERSION,
              sessionId: started.sessionId,
            },
            createdAt: now,
            updatedAt: now,
          };

          ctx = {
            threadId: input.threadId,
            session,
            scope: sessionScope,
            acp,
            notificationFiber: undefined,
            pendingApprovals,
            childTasks: new Map(),
            turns: [],
            lastPlanFingerprint: undefined,
            activeTurnId: undefined,
            promptsInFlight: 0,
            interruptionVersion: 0,
            stopped: false,
          };
          for (const observed of pendingObservedToolCalls.splice(0)) {
            yield* emitOhMyPiChildTaskEvents(ctx, observed);
          }

          const nf = yield* Stream.runDrain(
            Stream.mapEffect(acp.getEvents(), (event) =>
              Effect.gen(function* () {
                switch (event._tag) {
                  case "EventStreamBarrier":
                    yield* Deferred.succeed(event.acknowledge, undefined);
                    return;
                  case "ConfigOptionsUpdated":
                    return;
                  case "AvailableCommandsUpdated":
                    yield* (
                      options?.onAvailableCommands?.(event.availableCommands, cwd) ?? Effect.void
                    );
                    return;
                  case "ConnectionTerminated":
                    ctx.session = { ...ctx.session, status: "error", updatedAt: yield* nowIso };
                    yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
                    yield* settleActiveChildTasks(ctx, "Provider process exited");
                    yield* offerRuntimeEvent({
                      type: "session.exited",
                      ...(yield* makeEventStamp()),
                      provider: PROVIDER,
                      threadId: ctx.threadId,
                      payload: {
                        exitKind: "error",
                        recoverable: true,
                        reason: event.error.message,
                      },
                    });
                    return;
                  case "ModeChanged":
                    return;
                  case "AssistantItemStarted":
                    yield* offerRuntimeEvent(
                      makeAcpAssistantItemEvent({
                        stamp: yield* makeEventStamp(),
                        provider: PROVIDER,
                        threadId: ctx.threadId,
                        turnId: ctx.activeTurnId,
                        itemId: event.itemId,
                        lifecycle: "item.started",
                      }),
                    );
                    return;
                  case "AssistantItemCompleted":
                    yield* offerRuntimeEvent(
                      makeAcpAssistantItemEvent({
                        stamp: yield* makeEventStamp(),
                        provider: PROVIDER,
                        threadId: ctx.threadId,
                        turnId: ctx.activeTurnId,
                        itemId: event.itemId,
                        lifecycle: "item.completed",
                      }),
                    );
                    return;
                  case "PlanUpdated":
                    yield* logNative(
                      ctx.threadId,
                      "session/update",
                      event.rawPayload,
                      "acp.jsonrpc",
                    );
                    yield* emitPlanUpdate(
                      ctx,
                      event.payload,
                      event.rawPayload,
                      "acp.jsonrpc",
                      "session/update",
                    );
                    return;
                  case "ToolCallUpdated":
                    yield* logNative(
                      ctx.threadId,
                      "session/update",
                      event.rawPayload,
                      "acp.jsonrpc",
                    );
                    yield* offerRuntimeEvent(
                      makeAcpToolCallEvent({
                        stamp: yield* makeEventStamp(),
                        provider: PROVIDER,
                        threadId: ctx.threadId,
                        turnId: ctx.activeTurnId,
                        toolCall: event.toolCall,
                        rawPayload: event.rawPayload,
                      }),
                    );
                    return;
                  case "ThoughtDelta":
                  case "ContentDelta":
                    yield* logNative(
                      ctx.threadId,
                      "session/update",
                      event.rawPayload,
                      "acp.jsonrpc",
                    );
                    yield* offerRuntimeEvent(
                      makeAcpContentDeltaEvent({
                        stamp: yield* makeEventStamp(),
                        provider: PROVIDER,
                        threadId: ctx.threadId,
                        turnId: ctx.activeTurnId,
                        ...(event._tag === "ContentDelta" && event.itemId
                          ? { itemId: event.itemId }
                          : {}),
                        ...(event._tag === "ThoughtDelta" ? { streamKind: "reasoning_text" } : {}),
                        text: event.text,
                        rawPayload: event.rawPayload,
                      }),
                    );
                    return;
                }
              }),
            ),
          ).pipe(
            Effect.catch((cause) =>
              Effect.logError("Failed to process OhMyPi runtime notification.", { cause }),
            ),
            // Fork into the session scope, not the calling fiber. `forkChild`
            // makes this a child of `startSession`, and Effect interrupts a
            // fiber's children when it completes, so the consumer died as soon
            // as `startSession` returned and every later notification was
            // dropped. The scope is created, stored on the context and closed
            // on teardown already; only the fork target was wrong.
            Effect.forkIn(ctx.scope),
          );

          ctx.notificationFiber = nf;
          sessions.set(input.threadId, ctx);
          sessionScopeTransferred = true;

          yield* offerRuntimeEvent({
            type: "session.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { resume: started.initializeResult },
          });
          yield* offerRuntimeEvent({
            type: "session.state.changed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { state: "ready", reason: "OhMyPi ACP session ready" },
          });
          yield* offerRuntimeEvent({
            type: "thread.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { providerThreadId: started.sessionId },
          });

          return session;
        }).pipe(Effect.scoped),
      );

    const sendTurn: OhMyPiAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        // Serialize preparation through dispatch so a steer always sees the
        // reserved turn and can cancel a prompt that has reached the runtime.
        const sending = yield* withThreadLock(
          input.threadId,
          Effect.gen(function* () {
            const ctx = yield* requireSession(input.threadId);
            const interruptionVersion = ctx.interruptionVersion;
            // Keep a steering prompt under the active T3 turn until both RPCs settle.
            const steeringTurnId = ctx.promptsInFlight > 0 ? ctx.activeTurnId : undefined;
            const turnId = steeringTurnId ?? TurnId.make(yield* randomUUIDv4);
            // Count this prompt immediately so a superseded in-flight prompt
            // resolving from here on does not settle the turn; the matching
            // decrement is the `ensuring` below.
            ctx.activeTurnId = turnId;
            ctx.promptsInFlight += 1;
            const dispatched = yield* Deferred.make<void>();

            const sending = yield* Effect.gen(function* () {
              const turnModelSelection =
                input.modelSelection?.instanceId === boundInstanceId
                  ? input.modelSelection
                  : undefined;
              const model = turnModelSelection?.model ?? ctx.session.model;
              yield* applyRequestedSessionConfiguration({
                runtime: ctx.acp,
                runtimeMode: ctx.session.runtimeMode,
                interactionMode: input.interactionMode,
                modelSelection:
                  model === undefined
                    ? undefined
                    : {
                        model,
                        options: turnModelSelection?.options,
                      },
                mapError: ({ cause, method }) =>
                  mapAcpToAdapterError(PROVIDER, input.threadId, method, cause),
              });
              const modelConfig = (yield* ctx.acp.getConfigOptions).find(
                (option) => option.category === "model",
              );
              const resolvedModel =
                modelConfig?.type === "select" ? modelConfig.currentValue : model;
              ctx.activeTurnId = turnId;
              if (steeringTurnId === undefined) {
                ctx.lastPlanFingerprint = undefined;
              }
              ctx.session = {
                ...ctx.session,
                activeTurnId: turnId,
                updatedAt: yield* nowIso,
              };

              if (steeringTurnId === undefined) {
                yield* offerRuntimeEvent({
                  type: "turn.started",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                  payload: { model: resolvedModel },
                });
              }

              const promptParts: Array<EffectAcpSchema.ContentBlock> = [];
              const rawPrompt = input.input?.trim() ?? "";
              if (rawPrompt) {
                promptParts.push({ type: "text", text: rawPrompt });
              }
              if (input.attachments && input.attachments.length > 0) {
                for (const attachment of input.attachments) {
                  // Send images inline. Generic files reach the agent
                  // through the path line ProviderService puts in the prompt.
                  if (attachment.type !== "image") {
                    continue;
                  }
                  const attachmentPath = resolveAttachmentPath({
                    attachmentsDir: serverConfig.attachmentsDir,
                    attachment,
                  });
                  if (!attachmentPath) {
                    return yield* new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: "session/prompt",
                      detail: `Invalid attachment id '${attachment.id}'.`,
                    });
                  }
                  const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
                    Effect.mapError(
                      (cause) =>
                        new ProviderAdapterRequestError({
                          provider: PROVIDER,
                          method: "session/prompt",
                          detail: cause.message,
                          cause,
                        }),
                    ),
                  );
                  promptParts.push({
                    type: "image",
                    data: Buffer.from(bytes).toString("base64"),
                    mimeType: attachment.mimeType,
                  });
                }
              }

              if (promptParts.length === 0) {
                return yield* new ProviderAdapterValidationError({
                  provider: PROVIDER,
                  operation: "sendTurn",
                  issue: "Turn requires non-empty text or attachments.",
                });
              }

              if (steeringTurnId !== undefined) {
                yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
                yield* ctx.acp.cancel.pipe(
                  Effect.mapError((error) =>
                    mapAcpToAdapterError(PROVIDER, input.threadId, "session/cancel", error),
                  ),
                );
              }

              // ACP has no system-message field; keep runtime context separate from the user's text.
              const result =
                interruptionVersion !== ctx.interruptionVersion
                  ? { stopReason: "cancelled" as const }
                  : yield* ctx.acp
                      .prompt(
                        {
                          prompt: [
                            ...promptParts,
                            {
                              type: "text",
                              text: buildRuntimeInstructions({
                                harness: "OhMyPi",
                                model: resolvedModel,
                              }),
                            },
                          ],
                        },
                        { dispatched },
                      )
                      .pipe(
                        Effect.mapError((error) =>
                          mapAcpToAdapterError(PROVIDER, input.threadId, "session/prompt", error),
                        ),
                      );

              yield* ctx.acp.drainEvents;
              const turnRecord = ctx.turns.find((turn) => turn.id === turnId);
              if (turnRecord) {
                turnRecord.items.push({ prompt: promptParts, result });
              } else {
                ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, result }] });
              }
              ctx.session = {
                ...ctx.session,
                activeTurnId: turnId,
                updatedAt: yield* nowIso,
                model: resolvedModel,
              };

              // Only the last remaining prompt settles the turn — a steer-
              // superseded prompt resolving (usually cancelled) while another is
              // in flight or pending must leave the merged turn running.
              if (ctx.promptsInFlight === 1) {
                yield* offerRuntimeEvent({
                  type: "turn.completed",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                  payload: {
                    state: result.stopReason === "cancelled" ? "cancelled" : "completed",
                    stopReason: result.stopReason ?? null,
                  },
                });
              }

              return {
                threadId: input.threadId,
                turnId,
                resumeCursor: ctx.session.resumeCursor,
              };
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  ctx.promptsInFlight = Math.max(0, ctx.promptsInFlight - 1);
                }),
              ),
              Effect.forkIn(scope),
            );
            yield* Effect.raceFirst(Deferred.await(dispatched), Fiber.join(sending));
            return sending;
          }),
        );
        return yield* Fiber.join(sending);
      }).pipe(Effect.scoped);

    const interruptTurn: OhMyPiAdapterShape["interruptTurn"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        // Invalidate preparation even when ACP has no prompt to cancel yet.
        ctx.interruptionVersion += 1;
        yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
        yield* Effect.ignore(
          ctx.acp.cancel.pipe(
            Effect.mapError((error) =>
              mapAcpToAdapterError(PROVIDER, threadId, "session/cancel", error),
            ),
          ),
        );
      });

    const respondToRequest: OhMyPiAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/request_permission",
            detail: `Unknown pending approval request: ${requestId}`,
          });
        }
        yield* Deferred.succeed(pending.decision, decision);
      });

    const respondToUserInput: OhMyPiAdapterShape["respondToUserInput"] = () =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "session/elicitation",
          detail: "No pending OhMyPi user-input request.",
        }),
      );

    const readThread: OhMyPiAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        return { threadId, turns: ctx.turns };
      });

    const rollbackThread: OhMyPiAdapterShape["rollbackThread"] = () =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "rollbackThread",
          detail: "OhMyPi does not support conversation rollback through ACP.",
        }),
      );

    const stopSession: OhMyPiAdapterShape["stopSession"] = (threadId) =>
      withThreadLock(
        threadId,
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          yield* stopSessionInternal(ctx);
        }),
      );

    const listSessions: OhMyPiAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (c) => ({ ...c.session })));

    const hasSession: OhMyPiAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const c = sessions.get(threadId);
        return c !== undefined && !c.stopped && c.session.status !== "error";
      });

    const stopAll: OhMyPiAdapterShape["stopAll"] = () =>
      Effect.forEach(sessions.values(), stopSessionInternal, { discard: true });

    yield* Effect.addFinalizer(() =>
      Effect.forEach(sessions.values(), stopSessionInternal, { discard: true }).pipe(
        Effect.catch((cause) =>
          Effect.logError("Failed to emit OhMyPi session shutdown event.", { cause }),
        ),
        Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
        Effect.tap(() => managedNativeEventLogger?.close() ?? Effect.void),
      ),
    );

    const streamEvents = Stream.fromPubSub(runtimeEventPubSub);

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
      compaction: { type: "slash-command", command: "/compact" },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      rollbackThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents,
    } satisfies OhMyPiAdapterShape;
  });
}
