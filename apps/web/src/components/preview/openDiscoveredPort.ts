import type { DiscoveredLocalServer, ScopedThreadRef } from "@t3tools/contracts";
import {
  mapAtomCommandResult,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import type { BrowserSettingsReadError, OpenPreviewMutation } from "~/browser/openFileInPreview";
import { recordVisitForThread } from "~/browserHistoryStore";
import { ensureClientSettingsHydrated } from "~/hooks/useSettings";
import { useRightPanelStore } from "~/rightPanelStore";
import { openPreviewSession } from "./openPreviewSession";

export async function openDiscoveredPort<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly port: DiscoveredLocalServer;
  readonly openPreview: OpenPreviewMutation<E>;
}): Promise<AtomCommandResult<void, E | BrowserSettingsReadError>> {
  // The connection's localhost template is a client setting, which may still
  // be loading on a cold start. A failed read is reported by openPreviewSession.
  await ensureClientSettingsHydrated().catch(() => undefined);
  const resolvedUrl = resolveDiscoveredServerUrl(input.threadRef.environmentId, input.port.url);
  const result = await openPreviewSession({
    openPreview: input.openPreview,
    threadRef: input.threadRef,
    url: resolvedUrl,
  });
  return mapAtomCommandResult(result, (snapshot) => {
    recordVisitForThread(input.threadRef, input.port.url);
    useRightPanelStore.getState().openBrowser(input.threadRef, snapshot.tabId);
  });
}
