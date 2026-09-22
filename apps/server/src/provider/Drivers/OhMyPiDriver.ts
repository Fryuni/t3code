import {
  OH_MY_PI_DEFAULT_MODEL,
  OhMyPiSettings,
  ProviderDriverKind,
  TextGenerationError,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderDriverError } from "../Errors.ts";
import { probeOhMyPiWorkspaceCommands } from "../acp/OhMyPiAcpSupport.ts";
import { makeOhMyPiAdapter } from "../Layers/OhMyPiAdapter.ts";
import {
  OH_MY_PI_SESSION_OPTION_DESCRIPTORS,
  ohMyPiInstanceStateDir,
} from "../OhMyPiSessionOptions.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  buildServerProvider,
  isCommandMissingCause,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { probeOhMyPiModels } from "./OhMyPiModels.ts";
import { splitOhMyPiAvailableCommands } from "./OhMyPiSkillDispatch.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";

const DRIVER = ProviderDriverKind.make("ohMyPi");
const decodeSettings = Schema.decodeSync(OhMyPiSettings);
const capabilities = createModelCapabilities({
  optionDescriptors: OH_MY_PI_SESSION_OPTION_DESCRIPTORS,
});
/** Live sessions and probes both report per workspace; keep a bounded set. */
const MAX_WORKSPACE_SNAPSHOTS = 32;

export type OhMyPiDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

export const OhMyPiDriver: ProviderDriver<OhMyPiSettings, OhMyPiDriverEnv> = {
  driverKind: DRIVER,
  metadata: { displayName: "OhMyPi", supportsMultipleInstances: true },
  configSchema: OhMyPiSettings,
  defaultConfig: () => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const serverConfig = yield* ServerConfig;
      const eventLoggers = yield* ProviderEventLoggers;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const crypto = yield* Crypto.Crypto;
      const probeSessionsDir = path.join(
        ohMyPiInstanceStateDir(path, serverConfig.stateDir, instanceId),
        "probe-sessions",
      );
      const effectiveConfig = { ...config, enabled };
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind: DRIVER,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const initial = {
        ...buildServerProvider({
          presentation: { displayName: "OhMyPi", showInteractionModeToggle: true },
          enabled,
          checkedAt: DateTime.formatIso(yield* DateTime.now),
          models: [
            {
              slug: OH_MY_PI_DEFAULT_MODEL,
              name: "OhMyPi default",
              isDefault: true,
              isCustom: false,
              capabilities,
            },
          ],
          probe: {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: enabled
              ? "Checking OhMyPi availability."
              : "OhMyPi is disabled in T3 Code settings.",
          },
        }),
        supportsConversationRollback: false,
        supportsTextGeneration: false,
      } satisfies ServerProviderDraft;
      const metadata = yield* SubscriptionRef.make<ServerProviderDraft>(initial);
      const getSnapshot = SubscriptionRef.get(metadata).pipe(Effect.map(stampIdentity));
      const findWorkspace = (cwd: string) =>
        SubscriptionRef.get(metadata).pipe(
          Effect.map((draft) =>
            draft.workspaceSnapshots?.find((workspace) => workspace.cwd === cwd),
          ),
        );
      // omp's command list is the one source for a workspace's skills and slash
      // commands, whether a live session or the probe reported it.
      const recordWorkspaceCommands = (
        source: "live" | "probe",
        cwd: string,
        commands: ReadonlyArray<{
          readonly name: string;
          readonly description?: string | null;
          readonly input?: { readonly hint: string } | null;
        }>,
      ) =>
        SubscriptionRef.update(metadata, (draft) => {
          const recorded = draft.workspaceSnapshots ?? [];
          // A probe only runs for a workspace with no entry, so an entry that
          // appeared since came from a live session. omp advertises what its own
          // configuration enables and the probe launches without a thread's
          // options, so letting the slower probe land would narrow the menu.
          // Reading the entry rather than remembering the cwd keeps this in step
          // with eviction: a workspace that ages out can be probed again.
          if (source === "probe" && recorded.some((workspace) => workspace.cwd === cwd)) {
            return draft;
          }
          return {
            ...draft,
            workspaceSnapshots: [
              ...recorded.filter((workspace) => workspace.cwd !== cwd),
              { cwd, checkedAt: draft.checkedAt, ...splitOhMyPiAvailableCommands(commands) },
            ].slice(-MAX_WORKSPACE_SNAPSHOTS),
          };
        });
      // A throwaway ACP session in a T3-owned session directory; see ADR 0006.
      const probeWorkspace = (cwd: string) =>
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(probeSessionsDir, { recursive: true });
          const sessionDir = yield* fileSystem.makeTempDirectoryScoped({
            directory: probeSessionsDir,
            prefix: "session-",
          });
          const commands = yield* probeOhMyPiWorkspaceCommands({
            childProcessSpawner: spawner,
            ohMyPiSettings: effectiveConfig,
            environment: processEnv,
            cwd,
            sessionDir,
          });
          yield* recordWorkspaceCommands("probe", cwd, commands);
        }).pipe(
          Effect.scoped,
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError(
            (cause) =>
              new ProviderDriverError({
                driver: DRIVER,
                instanceId,
                detail: `Could not read OhMyPi commands for '${cwd}'.`,
                cause,
              }),
          ),
        );
      const checkProvider = Effect.gen(function* () {
        if (!enabled) return yield* getSnapshot;
        const result = yield* probeOhMyPiModels(effectiveConfig, processEnv, serverConfig.cwd).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.result,
        );
        const checkedAt = DateTime.formatIso(yield* DateTime.now);
        yield* SubscriptionRef.update(metadata, (draft): ServerProviderDraft => {
          if (result._tag === "Success") {
            return {
              ...draft,
              installed: true,
              version: result.success.version,
              models: [...initial.models, ...result.success.models],
              status: "ready",
              checkedAt,
              message:
                "Uses OhMyPi's local credentials. Run omp on the server to configure a model and sign in.",
            };
          }
          const cause = result.failure;
          const missing = isCommandMissingCause(cause);
          return {
            ...draft,
            installed: !missing,
            status: "error",
            checkedAt,
            message: missing
              ? "OhMyPi CLI (omp) is not installed or not on PATH."
              : "Could not load OhMyPi models. Check the binary path and run omp models --json on the server. The previous model list is unchanged.",
          };
        });
        return yield* getSnapshot;
      });
      const snapshot = yield* makeManagedServerProvider({
        resolveMaintenance: () =>
          Effect.succeed(
            makeManualOnlyProviderMaintenanceCapabilities({
              provider: DRIVER,
              packageName: "@oh-my-pi/pi-coding-agent",
            }),
          ),
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.empty,
        haveSettingsChanged: () => false,
        refreshOnInterval: false,
        initialSnapshot: () => getSnapshot,
        checkProvider,
        enrichSnapshot: ({ publishSnapshot }) =>
          SubscriptionRef.changes(metadata).pipe(
            Stream.runForEach((draft) => publishSnapshot(stampIdentity(draft))),
          ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER,
              instanceId,
              detail: "Failed to build OhMyPi snapshot.",
              cause,
            }),
        ),
      );
      const adapter = yield* makeOhMyPiAdapter(effectiveConfig, {
        instanceId,
        environment: processEnv,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        onAvailableCommands: (commands, cwd) => recordWorkspaceCommands("live", cwd, commands),
      });
      const unsupported = (operation: string) =>
        Effect.fail(
          new TextGenerationError({
            operation,
            detail:
              "OhMyPi does not support background text generation in T3 Code. Select another provider for this action.",
          }),
        );
      return {
        instanceId,
        driverKind: DRIVER,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot: { ...snapshot, getSnapshot },
        snapshotForCwd: (cwd) =>
          Effect.gen(function* () {
            if (enabled && (yield* findWorkspace(cwd)) === undefined) {
              yield* probeWorkspace(cwd);
            }
            const snapshot = yield* getSnapshot;
            const workspace = snapshot.workspaceSnapshots?.find((entry) => entry.cwd === cwd);
            return {
              ...snapshot,
              slashCommands: workspace?.slashCommands ?? [],
              skills: workspace?.skills ?? [],
            };
          }),
        adapter,
        textGeneration: {
          generateCommitMessage: () => unsupported("generateCommitMessage"),
          generatePrContent: () => unsupported("generatePrContent"),
          generateBranchName: () => unsupported("generateBranchName"),
          generateThreadTitle: () => unsupported("generateThreadTitle"),
        },
      } satisfies ProviderInstance;
    }),
};
