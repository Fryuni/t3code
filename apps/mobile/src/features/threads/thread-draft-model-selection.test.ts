import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveExistingThreadDraftModelSelection } from "./thread-draft-model-selection";

const instanceId = ProviderInstanceId.make("omp");
const providers = [
  {
    driver: ProviderDriverKind.make("ohMyPi"),
    instanceId,
    requiresNewThreadForModelChange: true,
  },
];

describe("existing thread draft model selection", () => {
  it("recovers a stale role draft to the persisted role after the session starts", () => {
    expect(
      resolveExistingThreadDraftModelSelection({
        thread: { instanceId, model: "default" },
        draft: { instanceId, model: "plan" },
        hasStartedSession: true,
        providers,
      }),
    ).toEqual({ instanceId, model: "default" });
  });

  it("preserves selectable drafts before start and for providers that can switch models", () => {
    const draft = { instanceId, model: "plan" };
    expect(
      resolveExistingThreadDraftModelSelection({
        thread: { instanceId, model: "default" },
        draft,
        hasStartedSession: false,
        providers,
      }),
    ).toBe(draft);
    expect(
      resolveExistingThreadDraftModelSelection({
        thread: { instanceId, model: "default" },
        draft,
        hasStartedSession: true,
        providers: [{ ...providers[0]!, requiresNewThreadForModelChange: false }],
      }),
    ).toBe(draft);
  });

  it("keeps the legacy OhMyPi default equivalent for a started session", () => {
    const draft = { instanceId, model: "default" };
    expect(
      resolveExistingThreadDraftModelSelection({
        thread: { instanceId, model: "oh-my-pi-default" },
        draft,
        hasStartedSession: true,
        providers,
      }),
    ).toBe(draft);
  });
});
