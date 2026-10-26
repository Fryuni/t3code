import {
  type BackgroundActivityProfile,
  type BackgroundActivitySettings,
  defaultInstanceIdForDriver,
  type EnvironmentId,
  type ProviderInstanceConfig,
  type PreviewViewportSetting,
  type ProviderInstanceId,
  type ServerSettings,
  type SidebarProjectGroupingMode,
  type UnifiedSettings,
} from "@t3tools/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  resolveProviderInstanceEnabled,
} from "@t3tools/contracts/settings";
import {
  getBackgroundActivityBaseProfile,
  normalizeBackgroundActivitySettings,
  normalizeServerBackgroundActivitySettings,
  resolveServerBackgroundActivitySettings,
} from "@t3tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";

export function isProjectGroupingEnabled(mode: SidebarProjectGroupingMode): boolean {
  return mode !== "separate";
}

export function projectGroupingModeFromToggle(
  enabled: boolean,
  lastEnabledMode: SidebarProjectGroupingMode = "repository",
): SidebarProjectGroupingMode {
  if (!enabled) return "separate";
  return lastEnabledMode === "repository_path" ? "repository_path" : "repository";
}

const LAST_ENABLED_PROJECT_GROUPING_MODE_KEY = "t3code:last-enabled-project-grouping-mode";

export function readLastEnabledProjectGroupingMode(): SidebarProjectGroupingMode {
  try {
    return localStorage.getItem(LAST_ENABLED_PROJECT_GROUPING_MODE_KEY) === "repository_path"
      ? "repository_path"
      : "repository";
  } catch {
    return "repository";
  }
}

export function rememberEnabledProjectGroupingMode(mode: SidebarProjectGroupingMode): void {
  if (mode === "separate") return;
  try {
    localStorage.setItem(LAST_ENABLED_PROJECT_GROUPING_MODE_KEY, mode);
  } catch {}
}

export function hasChangedBackgroundActivitySettings(
  settings: Pick<
    UnifiedSettings,
    | "backgroundActivity"
    | "backgroundActivityProfile"
    | "automaticGitFetchInterval"
    | "providerHealthRefreshInterval"
  >,
): boolean {
  return (
    !Equal.equals(settings.backgroundActivity, DEFAULT_UNIFIED_SETTINGS.backgroundActivity) ||
    settings.backgroundActivityProfile !== DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile ||
    !Equal.equals(
      settings.automaticGitFetchInterval,
      DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
    ) ||
    !Equal.equals(
      settings.providerHealthRefreshInterval,
      DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
    )
  );
}

type TypographySettings = Pick<
  UnifiedSettings,
  | "fontFamilySans"
  | "fontFamilyComposer"
  | "fontFamilyCode"
  | "fontFamilyTerminal"
  | "fontSizeInterface"
  | "fontSizePrompt"
  | "fontSizeCode"
  | "fontSizeTerminal"
>;

export function getChangedTypographySettingLabels(settings: TypographySettings): string[] {
  return [
    ...(settings.fontFamilySans !== DEFAULT_UNIFIED_SETTINGS.fontFamilySans ||
    settings.fontSizeInterface !== DEFAULT_UNIFIED_SETTINGS.fontSizeInterface
      ? ["Interface font"]
      : []),
    ...(settings.fontFamilyComposer !== DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer ||
    settings.fontSizePrompt !== DEFAULT_UNIFIED_SETTINGS.fontSizePrompt
      ? ["Prompt font"]
      : []),
    ...(settings.fontFamilyCode !== DEFAULT_UNIFIED_SETTINGS.fontFamilyCode ||
    settings.fontSizeCode !== DEFAULT_UNIFIED_SETTINGS.fontSizeCode
      ? ["Code font"]
      : []),
    ...(settings.fontFamilyTerminal !== DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal ||
    settings.fontSizeTerminal !== DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal
      ? ["Terminal font"]
      : []),
  ];
}

export type BrowserDefaultSettings = Pick<
  UnifiedSettings,
  | "browserDefaultViewport"
  | "browserDefaultZoomFactor"
  | "browserDefaultAppearance"
  | "browserRecordingFrameRate"
  | "browserRecordingShowKeyPresses"
  | "browserRecordingShowMousePresses"
  | "browserLinkTarget"
  | "browserSearchEngine"
  | "browserCustomSearchUrl"
  | "browserAutoShowFloatingPreview"
  | "pullRequestLinksOpenInApp"
>;

function isSamePreviewViewport(
  left: PreviewViewportSetting,
  right: PreviewViewportSetting,
): boolean {
  if (left._tag !== right._tag) return false;
  if (left._tag === "fill" || right._tag === "fill") return true;
  if (left.width !== right.width || left.height !== right.height) return false;
  return left._tag === "preset" && right._tag === "preset"
    ? left.presetId === right.presetId
    : true;
}

export function getChangedBrowserSettingLabels(settings: BrowserDefaultSettings): string[] {
  return [
    ...(isSamePreviewViewport(
      settings.browserDefaultViewport,
      DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport,
    )
      ? []
      : ["Browser viewport"]),
    ...(settings.browserDefaultZoomFactor !== DEFAULT_UNIFIED_SETTINGS.browserDefaultZoomFactor
      ? ["Browser zoom"]
      : []),
    ...(settings.browserDefaultAppearance !== DEFAULT_UNIFIED_SETTINGS.browserDefaultAppearance
      ? ["Browser appearance"]
      : []),
    ...(settings.browserRecordingFrameRate !== DEFAULT_UNIFIED_SETTINGS.browserRecordingFrameRate
      ? ["Recording frame rate"]
      : []),
    ...(settings.browserRecordingShowKeyPresses ? ["Recording key presses"] : []),
    ...(settings.browserRecordingShowMousePresses ? ["Recording mouse presses"] : []),
    ...(settings.browserLinkTarget !== DEFAULT_UNIFIED_SETTINGS.browserLinkTarget
      ? ["Open links in"]
      : []),
    ...(settings.browserSearchEngine !== DEFAULT_UNIFIED_SETTINGS.browserSearchEngine ||
    settings.browserCustomSearchUrl !== DEFAULT_UNIFIED_SETTINGS.browserCustomSearchUrl
      ? ["Search engine"]
      : []),
    ...(settings.browserAutoShowFloatingPreview !==
    DEFAULT_UNIFIED_SETTINGS.browserAutoShowFloatingPreview
      ? ["Floating preview"]
      : []),
    ...(settings.pullRequestLinksOpenInApp !== DEFAULT_UNIFIED_SETTINGS.pullRequestLinksOpenInApp
      ? ["Open pull requests in T3 Code"]
      : []),
  ];
}

export function resolveBackgroundActivityProfileOption(
  settings: ServerSettings,
): BackgroundActivityProfile | "advanced" {
  const resolved = resolveServerBackgroundActivitySettings(settings);
  const normalized = normalizeBackgroundActivitySettings({
    schemaVersion: 1,
    profile: "custom",
    baseProfile: resolved.profile,
    overrides: {
      automaticGitFetchInterval: resolved.automaticGitFetchInterval,
      providerHealthRefreshInterval: resolved.providerHealthRefreshInterval,
      hostPowerMonitorActiveInterval: resolved.hostPowerMonitorActiveInterval,
      hostPowerMonitorIdleInterval: resolved.hostPowerMonitorIdleInterval,
      idleClientTtl: resolved.idleClientTtl,
      pauseWhenHostLocked: resolved.pauseWhenHostLocked,
      pauseWhenHostLowPower: resolved.pauseWhenHostLowPower,
      pauseWhenClientLowPower: resolved.pauseWhenClientLowPower,
      pauseWhenOnBattery: resolved.pauseWhenOnBattery,
    },
  });
  return normalized.profile === "custom" ? "advanced" : normalized.profile;
}

export function backgroundActivitySharedPolicySettings(
  settings: ServerSettings,
  profile: BackgroundActivityProfile,
): BackgroundActivitySettings {
  const normalized = normalizeServerBackgroundActivitySettings(settings);
  return {
    schemaVersion: 1,
    profile: "custom",
    baseProfile: profile,
    overrides: normalized.profile === "custom" ? normalized.overrides : {},
  };
}

export function buildProviderInstanceUpdatePatch(input: {
  readonly settings: Pick<ServerSettings, "providerInstances">;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly textGenerationModelSelection?:
    | ServerSettings["textGenerationModelSelection"]
    | undefined;
}): Partial<UnifiedSettings> {
  return {
    providerInstances: {
      ...input.settings.providerInstances,
      [input.instanceId]: input.instance,
    },
    ...(input.textGenerationModelSelection !== undefined
      ? { textGenerationModelSelection: input.textGenerationModelSelection }
      : {}),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type EnvironmentVariables = NonNullable<ProviderInstanceConfig["environment"]>;

// By name, so an edit to one variable leaves the target's other variables,
// and the secrets behind them, alone.
function applyChangedVariables(
  target: EnvironmentVariables,
  previous: EnvironmentVariables,
  next: EnvironmentVariables,
): EnvironmentVariables {
  const result = new Map(target.map((variable) => [variable.name, variable]));
  const before = new Map(previous.map((variable) => [variable.name, variable]));
  const after = new Map(next.map((variable) => [variable.name, variable]));
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const variable = after.get(name);
    if (Equal.equals(before.get(name), variable)) continue;
    if (variable === undefined) result.delete(name);
    else result.set(name, variable);
  }
  return [...result.values()];
}

function applyChangedFields(
  target: Record<string, unknown>,
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const before = previous[key];
    const after = next[key];
    if (Equal.equals(before, after)) continue;
    const current = result[key];
    let merged: unknown = after;
    // The form omits `config` once its last field is cleared; that clears
    // those fields, not the target's own.
    if (
      key === "config" &&
      (after === undefined || isPlainObject(after)) &&
      (before === undefined || isPlainObject(before))
    ) {
      merged = applyChangedFields(isPlainObject(current) ? current : {}, before ?? {}, after ?? {});
      if (Object.keys(merged as object).length === 0) merged = undefined;
    } else if (key === "environment") {
      merged = applyChangedVariables(
        (current ?? []) as EnvironmentVariables,
        (before ?? []) as EnvironmentVariables,
        (after ?? []) as EnvironmentVariables,
      );
      if ((merged as EnvironmentVariables).length === 0) merged = undefined;
    }
    if (merged === undefined) delete result[key];
    else result[key] = merged;
  }
  return result;
}

/**
 * Copies only the fields an instance edit changed onto each environment's own copy, so its paths
 * and saved secrets survive. Environments without the instance, or with another driver under its
 * id, are skipped; a driver's default slot exists everywhere.
 */
export function planProviderInstanceSync(input: {
  readonly instanceId: ProviderInstanceId;
  readonly previous: ProviderInstanceConfig;
  readonly next: ProviderInstanceConfig;
  readonly targets: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly settings: Pick<ServerSettings, "providerInstances" | "textGenerationModelSelection">;
  }>;
}) {
  const { instanceId, previous, next } = input;
  return input.targets.flatMap(({ environmentId, settings }) => {
    const current: ProviderInstanceConfig | undefined = Object.hasOwn(
      settings.providerInstances,
      instanceId,
    )
      ? settings.providerInstances[instanceId]
      : instanceId === defaultInstanceIdForDriver(next.driver)
        ? { driver: next.driver }
        : undefined;
    if (current?.driver !== next.driver) return [];
    const instance = applyChangedFields(current, previous, next) as ProviderInstanceConfig;
    if (Equal.equals(instance, current)) return [];
    const disables =
      resolveProviderInstanceEnabled(current) && !resolveProviderInstanceEnabled(instance);
    return [
      {
        environmentId,
        instance,
        patch:
          disables && settings.textGenerationModelSelection.instanceId === instanceId
            ? {
                textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
              }
            : {},
      },
    ];
  });
}

type ProviderInstances = Pick<ServerSettings, "providerInstances">;

/**
 * What was last sent to one environment for one instance. A remote may not
 * have echoed an earlier write yet, and the next edit must build on what was
 * sent, or it would undo that write there.
 */
export interface PendingProviderSync {
  readonly instance: ProviderInstanceConfig;
  readonly inFlight: number;
  /** The environment's settings when the last reply arrived; null while in flight. */
  readonly settledOn: ProviderInstances | null;
}

export function sendPendingProviderSync(
  pending: PendingProviderSync | undefined,
  instance: ProviderInstanceConfig,
): PendingProviderSync {
  return { instance, inFlight: (pending?.inFlight ?? 0) + 1, settledOn: null };
}

/**
 * `reply` is the server's settings, or null when the write failed. The reply
 * is redacted as the settings stream sends it, so it replaces what was sent
 * unless a later write already has. A failed last write changed nothing there,
 * so nothing will be echoed.
 */
export function settlePendingProviderSync(input: {
  readonly pending: PendingProviderSync;
  readonly instanceId: ProviderInstanceId;
  readonly sent: ProviderInstanceConfig;
  readonly reply: ProviderInstances | null;
  readonly latest: ProviderInstances | null;
}): PendingProviderSync | undefined {
  const { pending, instanceId, sent, reply, latest } = input;
  const inFlight = pending.inFlight - 1;
  if (inFlight === 0 && reply === null) return undefined;
  return {
    instance:
      reply !== null && pending.instance === sent
        ? (reply.providerInstances[instanceId] ?? sent)
        : pending.instance,
    inFlight,
    settledOn: latest,
  };
}

/**
 * Settings arrive on a stream separate from the reply. A settled write is
 * current once they show the server's copy, or once anything newer than the
 * reply arrives.
 */
export function isPendingProviderSyncCurrent(
  pending: PendingProviderSync,
  instanceId: ProviderInstanceId,
  settings: ProviderInstances,
): boolean {
  return (
    pending.inFlight === 0 &&
    (Equal.equals(settings.providerInstances[instanceId], pending.instance) ||
      settings !== pending.settledOn)
  );
}

export const PROVIDER_HEALTH_INTERVAL_STEP_SECONDS = 30;

type BackgroundActivityOverridePatch = Partial<{
  [K in keyof BackgroundActivitySettings["overrides"]]:
    | BackgroundActivitySettings["overrides"][K]
    | undefined;
}>;

export function durationToSeconds(duration: Duration.Duration): number {
  return Math.round(Duration.toMillis(duration) / 1_000);
}

export function normalizeIntervalSeconds(value: number | null, minimum = 0): number {
  if (value === null || !Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.round(value));
}

export function backgroundActivityOverrideSettings(
  current: BackgroundActivitySettings,
  resolved: ReturnType<typeof resolveServerBackgroundActivitySettings>,
  overrides: BackgroundActivityOverridePatch,
) {
  const nextOverrides: BackgroundActivityOverridePatch = {
    automaticGitFetchInterval: resolved.automaticGitFetchInterval,
    providerHealthRefreshInterval: resolved.providerHealthRefreshInterval,
    hostPowerMonitorActiveInterval: resolved.hostPowerMonitorActiveInterval,
    hostPowerMonitorIdleInterval: resolved.hostPowerMonitorIdleInterval,
    idleClientTtl: resolved.idleClientTtl,
    pauseWhenHostLocked: resolved.pauseWhenHostLocked,
    pauseWhenHostLowPower: resolved.pauseWhenHostLowPower,
    pauseWhenClientLowPower: resolved.pauseWhenClientLowPower,
    pauseWhenOnBattery: resolved.pauseWhenOnBattery,
    ...overrides,
  };
  for (const [key, value] of Object.entries(nextOverrides)) {
    if (value === undefined) {
      delete nextOverrides[key as keyof typeof nextOverrides];
    }
  }
  return {
    backgroundActivity: {
      schemaVersion: 1 as const,
      profile: "custom" as const,
      baseProfile: getBackgroundActivityBaseProfile(current),
      overrides: nextOverrides as BackgroundActivitySettings["overrides"],
    },
  };
}
