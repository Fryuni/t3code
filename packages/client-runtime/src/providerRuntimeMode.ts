import type { ProviderDriverKind, RuntimeMode, ServerProvider } from "@t3tools/contracts";

const FULL_ACCESS_RUNTIME_MODE = "full-access" satisfies RuntimeMode;

function isFullAccessOnlyProvider(
  provider: Pick<ServerProvider, "driver"> | ProviderDriverKind | null | undefined,
): boolean {
  const driver = typeof provider === "string" ? provider : provider?.driver;
  return driver === "ohMyPi";
}

export function resolveProviderRuntimeMode(
  provider: Pick<ServerProvider, "driver"> | ProviderDriverKind | null | undefined,
  runtimeMode: RuntimeMode,
): RuntimeMode {
  return isFullAccessOnlyProvider(provider) ? FULL_ACCESS_RUNTIME_MODE : runtimeMode;
}

export function runtimeModeOptionsForProvider(
  provider: Pick<ServerProvider, "driver"> | ProviderDriverKind | null | undefined,
  options: ReadonlyArray<RuntimeMode>,
): ReadonlyArray<RuntimeMode> {
  return isFullAccessOnlyProvider(provider) ? [FULL_ACCESS_RUNTIME_MODE] : options;
}
