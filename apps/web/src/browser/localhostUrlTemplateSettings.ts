import type { EnvironmentId } from "@t3tools/contracts";

import { persistClientSettingsUpdate } from "~/hooks/useSettings";

/**
 * Saves a connection's localhost template on this device, or clears it when
 * `template` is null. Client-settings patches replace a record whole, so this
 * rewrites the one key against the hydrated snapshot rather than patching.
 */
export async function saveBrowserLocalhostUrlTemplate(
  environmentId: EnvironmentId,
  template: string | null,
): Promise<void> {
  await persistClientSettingsUpdate((current) => {
    const existing = current.browserLocalhostUrlTemplates;
    if (template === null) {
      if (existing[environmentId] === undefined) return current;
      const { [environmentId]: _removed, ...rest } = existing;
      return { ...current, browserLocalhostUrlTemplates: rest };
    }
    return {
      ...current,
      browserLocalhostUrlTemplates: { ...existing, [environmentId]: template.trim() },
    };
  });
}
