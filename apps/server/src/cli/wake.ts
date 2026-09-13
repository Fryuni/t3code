import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  CommandId,
  EnvironmentHttpApi,
  MessageId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ThreadId,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Argument, Command, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { baseDirFlag } from "./config.ts";
import { discoverRunningServer, makeDiscoveredServerConfig } from "./runningServer.ts";

class WakeCommandError extends Schema.TaggedError<WakeCommandError>()("WakeCommandError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const wakeCommand = Command.make("wake", {
  baseDir: baseDirFlag,
  threadId: Argument.string("thread-id").pipe(
    Argument.withSchema(ThreadId),
    Argument.withDescription("ID of the existing thread to wake."),
  ),
  message: Argument.string("message").pipe(
    Argument.withDescription("Message to send to the agent (quote messages containing spaces)."),
  ),
}).pipe(
  Command.withDescription(
    "Send a message and start a turn in an existing thread. Requires a running server or desktop app.",
  ),
  Command.withHandler(
    Effect.fn("wakeCommand")(function* (flags) {
      if (flags.message.trim().length === 0) {
        return yield* new WakeCommandError({ message: "Message cannot be empty." });
      }
      if (flags.message.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS) {
        return yield* new WakeCommandError({
          message: `Message cannot exceed ${PROVIDER_SEND_TURN_MAX_INPUT_CHARS} characters.`,
        });
      }
      const logLevel = Option.getOrElse(yield* GlobalFlag.LogLevel, () => "Info" as const);
      const target = yield* discoverRunningServer(Option.getOrUndefined(flags.baseDir));
      const config = yield* makeDiscoveredServerConfig({ target, logLevel });

      yield* Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const client = yield* HttpApiClient.make(EnvironmentHttpApi, {
          baseUrl: target.state.origin,
        });
        const crypto = yield* Crypto.Crypto;
        yield* Effect.acquireUseRelease(
          auth.issueSession({
            scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
            label: "t3 wake cli",
          }),
          (session) =>
            Effect.gen(function* () {
              const headers = { authorization: `Bearer ${session.token}` };
              const { thread } = yield* client.orchestration
                .threadSnapshot({
                  headers,
                  params: { threadId: flags.threadId },
                  payload: { turnLimit: 1 },
                })
                .pipe(
                  Effect.timeout("5 seconds"),
                  Effect.mapError(
                    (cause) =>
                      new WakeCommandError({
                        message: `Could not read thread '${flags.threadId}' from the running server. Check the thread ID and that the server is still running.`,
                        cause,
                      }),
                  ),
                );
              if (thread.deletedAt !== null) {
                return yield* new WakeCommandError({
                  message: `Thread '${flags.threadId}' has been deleted.`,
                });
              }
              yield* client.orchestration
                .dispatch({
                  headers,
                  payload: {
                    type: "thread.turn.start",
                    commandId: CommandId.make(yield* crypto.randomUUIDv4),
                    threadId: thread.id,
                    message: {
                      messageId: MessageId.make(yield* crypto.randomUUIDv4),
                      role: "user",
                      text: flags.message,
                      attachments: [],
                    },
                    runtimeMode: thread.runtimeMode,
                    interactionMode: thread.interactionMode,
                    createdAt: DateTime.formatIso(yield* DateTime.now),
                  },
                })
                .pipe(
                  Effect.timeout("10 seconds"),
                  Effect.mapError(
                    (cause) =>
                      new WakeCommandError({
                        message: `Could not confirm delivery to thread '${flags.threadId}'. Check the thread before retrying.`,
                        cause,
                      }),
                  ),
                );
            }),
          (session) => auth.revokeSession(session.sessionId).pipe(Effect.ignore({ log: true })),
        );
      }).pipe(
        Effect.provide(
          EnvironmentAuth.runtimeLayer.pipe(
            Layer.provide(ServerConfig.layer(config)),
            Layer.provide(Layer.succeed(References.MinimumLogLevel, logLevel)),
          ),
        ),
      );
      yield* Console.log(`Sent message to thread ${flags.threadId}; turn requested.`);
    }, Effect.provide(FetchHttpClient.layer)),
  ),
);
