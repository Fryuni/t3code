import type { ModelSelection, ServerProvider } from "@t3tools/contracts";

import { threadRoleSelectionsMatch } from "./thread-settings-sheet-state";

export function resolveExistingThreadDraftModelSelection(input: {
  readonly thread: ModelSelection;
  readonly draft: ModelSelection | null | undefined;
  readonly hasStartedSession: boolean;
  readonly providers: ReadonlyArray<
    Pick<ServerProvider, "driver" | "instanceId" | "requiresNewThreadForModelChange">
  >;
}): ModelSelection {
  if (!input.draft || !input.hasStartedSession) {
    return input.draft ?? input.thread;
  }

  const provider = input.providers.find(
    (candidate) => candidate.instanceId === input.thread.instanceId,
  );
  if (
    provider?.requiresNewThreadForModelChange !== true ||
    threadRoleSelectionsMatch({
      providerDriver: provider.driver,
      current: input.thread,
      next: input.draft,
    })
  ) {
    return input.draft;
  }

  return input.thread;
}
