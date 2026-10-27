import type { ServerProviderModel } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";

import { PiRpcError, PiRpcTimeoutError } from "./rpc.ts";
import {
  EMPTY_PI_MODEL_CAPABILITIES,
  thinkingCapabilitiesForPiModel,
} from "./thinkingCapabilities.ts";

// OhMyPi (`omp`) model presets name a whole set of role models; T3 lists them as models.
const PI_PRESET_SLUG_PREFIX = "preset:";
const PRESET_NAME_PATTERN = /^[a-zA-Z][\w-]*$/;
const OMP_CONFIG_TIMEOUT_MS = 10_000;
const OMP_THINKING_LEVELS = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** omp's thinking selector parsing: exact, or an unambiguous prefix of two or more characters. */
function parseOmpThinkingLevel(value: string): string | undefined {
  if (OMP_THINKING_LEVELS.includes(value)) return value;
  if (value.length < 2) return undefined;
  const matches = OMP_THINKING_LEVELS.filter((level) => level.startsWith(value));
  return matches.length === 1 ? matches[0] : undefined;
}

/** omp's rule for a preset's `defaultThinkingLevel`: `auto` or an effort, never `off`/`inherit`. */
function parseOmpDefaultThinkingLevel(value: string): string | undefined {
  if (value === "auto") return value;
  const level = parseOmpThinkingLevel(value);
  return level === "off" || level === "inherit" ? undefined : level;
}

const decodeOmpConfigOutput = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ value: Schema.optional(Schema.Unknown) })),
);
export const encodeOmpConfigOverlay = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const OMP_AUTO_THINKING = "auto";

export interface OmpModelPreset {
  readonly name: string;
  readonly modelRoles: Readonly<Record<string, string>>;
  readonly defaultThinkingLevel: string | undefined;
}

export function piPresetSlug(name: string): string {
  return `${PI_PRESET_SLUG_PREFIX}${name}`;
}

export function piPresetNameFromSlug(slug: string): string | undefined {
  return slug.startsWith(PI_PRESET_SLUG_PREFIX)
    ? slug.slice(PI_PRESET_SLUG_PREFIX.length)
    : undefined;
}

export function isOmpVersionOutput(output: string): boolean {
  return /^omp\/\d/m.test(output);
}

function isStringRecord(input: unknown): input is Record<string, unknown> {
  return Predicate.isObject(input) && !Array.isArray(input);
}

/** Mirrors omp's own preset validation; hand-edited config can hold anything. */
function parseOmpModelPresets(value: unknown): ReadonlyArray<OmpModelPreset> {
  if (!isStringRecord(value)) return [];
  const presets: Array<OmpModelPreset> = [];
  for (const [name, raw] of Object.entries(value)) {
    if (!PRESET_NAME_PATTERN.test(name) || !isStringRecord(raw)) continue;
    const roles = raw.modelRoles;
    if (!isStringRecord(roles)) continue;
    const modelRoles: Record<string, string> = {};
    let valid = true;
    for (const [role, selector] of Object.entries(roles)) {
      if (typeof selector !== "string" || selector.trim() === "") {
        valid = false;
        break;
      }
      modelRoles[role] = selector;
    }
    const rawLevel = raw.defaultThinkingLevel;
    const level = typeof rawLevel === "string" ? parseOmpDefaultThinkingLevel(rawLevel) : undefined;
    // T3 sets the main model from `default`; without one omp would pick a model T3 cannot see.
    if (!valid || modelRoles.default === undefined || (rawLevel !== undefined && !level)) {
      continue;
    }
    presets.push({ name, modelRoles, defaultThinkingLevel: level });
  }
  return presets.toSorted((left, right) => left.name.localeCompare(right.name));
}

/** `provider/id` slugs from a Pi RPC `get_available_models` response. */
export function piModelInventorySlugs(modelInventory: unknown): ReadonlySet<string> {
  const models = isStringRecord(modelInventory) ? modelInventory.models : undefined;
  if (!Array.isArray(models)) return new Set();
  return new Set(
    models.flatMap((model) =>
      isStringRecord(model) && typeof model.provider === "string" && typeof model.id === "string"
        ? [`${model.provider}/${model.id}`]
        : [],
    ),
  );
}

/**
 * Splits an omp role selector (`provider/model[:level]`) into what Pi RPC `set_model` takes.
 * Like omp, an exact model id wins over reading its last `:segment` as a thinking level.
 * shortcut: aliases (`@slow`) and bare model patterns need omp's fuzzy resolver, so they are
 * reported as unsupported; add an RPC-side resolution if presets commonly use them.
 */
export function parseOmpModelSelector(
  selector: string,
  knownModels: ReadonlySet<string>,
): {
  readonly provider: string;
  readonly modelId: string;
  readonly thinking: string | undefined;
} | null {
  const colon = selector.lastIndexOf(":");
  const suffix = colon === -1 ? undefined : selector.slice(colon + 1);
  const thinking =
    suffix !== undefined && !knownModels.has(selector) ? parseOmpThinkingLevel(suffix) : undefined;
  const model = thinking === undefined ? selector : selector.slice(0, colon);
  const separator = model.indexOf("/");
  if (model.startsWith("@") || separator <= 0 || separator === model.length - 1) return null;
  return { provider: model.slice(0, separator), modelId: model.slice(separator + 1), thinking };
}

/** The level a preset starts at: the `default` selector's suffix wins over `defaultThinkingLevel`. */
function ompPresetThinkingLevel(
  preset: OmpModelPreset,
  knownModels: ReadonlySet<string>,
): string | undefined {
  const selector = preset.modelRoles.default;
  const fromSelector =
    selector === undefined ? undefined : parseOmpModelSelector(selector, knownModels)?.thinking;
  return fromSelector ?? preset.defaultThinkingLevel;
}

/**
 * `--config` overlay content for a preset. Roles the preset leaves out are written as `null`
 * tombstones so global roles do not leak in, matching omp's own `/modelpreset switch`.
 */
function ompPresetOverlay(
  preset: OmpModelPreset,
  effectiveRoles: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const modelRoles: Record<string, string | null> = {};
  for (const role of Object.keys(effectiveRoles)) modelRoles[role] = null;
  Object.assign(modelRoles, preset.modelRoles);
  return {
    modelRoles,
    ...(preset.defaultThinkingLevel === undefined
      ? {}
      : { defaultThinkingLevel: preset.defaultThinkingLevel }),
  };
}

/** Pi models have no `auto` level; a preset that uses omp's `auto` offers it as its default. */
function presetThinkingCapabilities(rawModel: unknown, level: string | undefined) {
  const capabilities = thinkingCapabilitiesForPiModel(rawModel, level);
  if (level !== OMP_AUTO_THINKING) return capabilities;
  return {
    optionDescriptors: capabilities.optionDescriptors?.map((descriptor) =>
      descriptor.type === "select"
        ? {
            ...descriptor,
            options: [
              { id: OMP_AUTO_THINKING, label: "Auto", isDefault: true },
              ...descriptor.options,
            ],
          }
        : descriptor,
    ),
  };
}

export function ompPresetModels(
  presets: ReadonlyArray<OmpModelPreset>,
  modelInventory: unknown,
): ReadonlyArray<ServerProviderModel> {
  const inventory = isStringRecord(modelInventory) ? modelInventory.models : undefined;
  const rawModels: ReadonlyArray<unknown> = Array.isArray(inventory) ? inventory : [];
  const knownModels = piModelInventorySlugs(modelInventory);
  return presets.map((preset) => {
    const selector = preset.modelRoles.default;
    const parsed = selector === undefined ? null : parseOmpModelSelector(selector, knownModels);
    const rawModel =
      parsed === null
        ? undefined
        : rawModels.find(
            (model) =>
              isStringRecord(model) &&
              model.provider === parsed.provider &&
              model.id === parsed.modelId,
          );
    return {
      slug: piPresetSlug(preset.name),
      name: preset.name,
      subProvider: "Preset",
      isCustom: false,
      capabilities:
        rawModel === undefined
          ? EMPTY_PI_MODEL_CAPABILITIES
          : presetThinkingCapabilities(rawModel, ompPresetThinkingLevel(preset, knownModels)),
    };
  });
}

interface OmpConfigReadInput {
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string | undefined;
  /** Resolved Pi launch args; their `--profile` selects which omp config is read. */
  readonly launchArgs: ReadonlyArray<string>;
}

function ompProfileArgs(launchArgs: ReadonlyArray<string>): ReadonlyArray<string> {
  const index = launchArgs.findIndex((arg) => arg === "--profile" || arg.startsWith("--profile="));
  if (index === -1) return [];
  const arg = launchArgs[index]!;
  if (arg !== "--profile") return [arg];
  const value = launchArgs[index + 1];
  return value === undefined ? [] : [arg, value];
}

const readOmpConfigValue = Effect.fn("PiPresets.readOmpConfigValue")(
  function* (input: OmpConfigReadInput & { readonly key: string }) {
    // omp only reads `--profile` before the subcommand.
    const args = [...ompProfileArgs(input.launchArgs), "config", "get", input.key, "--json"];
    const spawnCommand = yield* resolveSpawnCommand(input.binaryPath, args, {
      env: input.environment,
    });
    const result = yield* spawnAndCollect(
      input.binaryPath,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: input.environment,
        shell: spawnCommand.shell,
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      }),
    );
    const detail = `\`omp config get ${input.key}\``;
    if (result.code !== 0) {
      return yield* new PiRpcError({
        operation: "omp_config",
        detail: `${detail} exited ${result.code}`,
      });
    }
    const parsed = yield* decodeOmpConfigOutput(result.stdout).pipe(
      Effect.mapError(
        (cause) =>
          new PiRpcError({
            operation: "omp_config",
            detail: `${detail} printed invalid JSON`,
            cause,
          }),
      ),
    );
    return parsed.value;
  },
  Effect.timeoutOrElse({
    duration: OMP_CONFIG_TIMEOUT_MS,
    orElse: () =>
      Effect.fail(
        new PiRpcTimeoutError({ operation: "omp_config", timeoutMs: OMP_CONFIG_TIMEOUT_MS }),
      ),
  }),
);

/**
 * shortcut: `omp config get` returns presets deep-merged across config layers, while omp takes a
 * same-name preset whole from its highest layer; read the layer files if that ever matters.
 */
export const readOmpModelPresets = (input: OmpConfigReadInput) =>
  readOmpConfigValue({ ...input, key: "modelPresets" }).pipe(Effect.map(parseOmpModelPresets));

/** Resolves a preset by name and builds its overlay against the workspace's current roles. */
export const resolveOmpPreset = Effect.fn("PiPresets.resolveOmpPreset")(function* (
  input: OmpConfigReadInput & { readonly name: string },
) {
  const [presets, roles, configuredThinking] = yield* Effect.all(
    [
      readOmpModelPresets(input),
      readOmpConfigValue({ ...input, key: "modelRoles" }),
      readOmpConfigValue({ ...input, key: "defaultThinkingLevel" }),
    ],
    { concurrency: "unbounded" },
  );
  const preset = presets.find((candidate) => candidate.name === input.name);
  if (preset === undefined) {
    return yield* new PiRpcError({
      operation: "omp_preset",
      detail: `OhMyPi model preset '${input.name}' was not found, is malformed, or has no main (default) model`,
    });
  }
  return {
    preset,
    overlay: ompPresetOverlay(preset, isStringRecord(roles) ? roles : {}),
    // What omp falls back to when the preset sets no level.
    configuredThinkingLevel:
      typeof configuredThinking === "string"
        ? parseOmpDefaultThinkingLevel(configuredThinking)
        : undefined,
  };
});
