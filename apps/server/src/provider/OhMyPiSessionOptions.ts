/**
 * OhMyPiSessionOptions — the omp session behaviors T3 Code owns as provider
 * options: the advisor, computer use, and prewalk.
 *
 * omp's CLI users switch these on with slash commands before their first
 * message. Over ACP those commands only change the running process: the
 * session file never records them, and `session/load` in a fresh process comes
 * back with all three off. T3 stops idle sessions and resumes them by id, so
 * the desired state is stated again at every launch instead, and every launch
 * states all three explicitly so omp's global config never decides.
 *
 * Prewalk travels as `--prewalk` / `--no-prewalk`: omp ignores its config key
 * while restoring a session, but honors the flags. Advisor and computer use
 * have no off flag, so they ride a `--config` overlay that omp deep-merges over
 * its global and project config. Verified against omp 18.2.7; see ADR 0005.
 *
 * @module provider/OhMyPiSessionOptions
 */
import type { ProviderOptionDescriptor, ProviderOptionSelection } from "@t3tools/contracts";
import { getProviderOptionBooleanSelectionValue } from "@t3tools/shared/model";

export const OH_MY_PI_SESSION_OPTION_DESCRIPTORS: ReadonlyArray<ProviderOptionDescriptor> = [
  { id: "advisor", label: "Advisor", type: "boolean" },
  { id: "computerUse", label: "Computer use", type: "boolean" },
  { id: "prewalk", label: "Prewalk", type: "boolean" },
];

/** Option ids that only apply when the omp process starts, for the adapter's restart capability. */
export const OH_MY_PI_SESSION_OPTION_IDS: ReadonlyArray<string> =
  OH_MY_PI_SESSION_OPTION_DESCRIPTORS.map((descriptor) => descriptor.id);

export interface OhMyPiSessionToggles {
  readonly advisor: boolean;
  readonly computerUse: boolean;
  readonly prewalk: boolean;
}

/** An absent selection is off: composers omit descriptor defaults from dispatch. */
export function resolveOhMyPiSessionToggles(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): OhMyPiSessionToggles {
  return {
    advisor: getProviderOptionBooleanSelectionValue(selections, "advisor") === true,
    computerUse: getProviderOptionBooleanSelectionValue(selections, "computerUse") === true,
    prewalk: getProviderOptionBooleanSelectionValue(selections, "prewalk") === true,
  };
}

/**
 * The overlay omp reads through `--config`, carrying the two toggles that have
 * no off flag; prewalk travels as a flag. Keys are nested, not dotted: omp
 * splits its own dotted setting paths when it reads the merged tree. The file
 * name encodes the two values, so concurrent sessions that differ on either
 * never share one file.
 */
export function ohMyPiConfigOverlay(toggles: OhMyPiSessionToggles): {
  readonly fileName: string;
  readonly contents: string;
} {
  const state = (enabled: boolean) => (enabled ? "on" : "off");
  return {
    fileName: `advisor-${state(toggles.advisor)}.computer-${state(toggles.computerUse)}.yml`,
    contents: [
      "advisor:",
      `  enabled: ${toggles.advisor}`,
      "computer:",
      `  enabled: ${toggles.computerUse}`,
      "",
    ].join("\n"),
  };
}

export function ohMyPiLaunchArgs(input: {
  readonly toggles: OhMyPiSessionToggles;
  readonly overlayPath: string;
}): ReadonlyArray<string> {
  return [input.toggles.prewalk ? "--prewalk" : "--no-prewalk", "--config", input.overlayPath];
}

/** Per-instance runtime state under T3's userdata: launch overlays and probe session files. */
export function ohMyPiInstanceStateDir(
  path: { readonly join: (...segments: ReadonlyArray<string>) => string },
  stateDir: string,
  instanceId: string,
): string {
  return path.join(stateDir, "ohmypi", instanceId);
}
