import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type ProviderOptionSelection } from "@t3tools/contracts";

import type { ModelOption } from "../../lib/modelOptions";
import {
  canCommitPendingModel,
  modelMatchesCatalogQuery,
  modelIsDisplayed,
  pendingModelAfterPress,
  startedThreadModelChangeBlockReason,
} from "./thread-settings-sheet-state";

function modelOption(
  model: string,
  options: ReadonlyArray<ProviderOptionSelection> = [],
): ModelOption {
  return {
    key: `codex:${model}`,
    label: model,
    subtitle: "",
    providerKey: "codex",
    providerLabel: "Codex",
    providerDriver: "codex",
    isDefault: false,
    isLegacy: false,
    capabilities: null,
    selection: {
      instanceId: ProviderInstanceId.make("codex"),
      model,
      options,
    },
  };
}

describe("thread settings sheet state", () => {
  it("matches visible model and provider terms", () => {
    const model = modelOption("gpt-next");

    expect(modelMatchesCatalogQuery({ model, providerLabel: "Codex", query: "NEXT" })).toBe(true);
    expect(modelMatchesCatalogQuery({ model, providerLabel: "Codex", query: "codex" })).toBe(true);
    expect(modelMatchesCatalogQuery({ model, providerLabel: "Codex", query: "claude" })).toBe(
      false,
    );
  });

  it("treats whitespace-only catalog searches as empty", () => {
    expect(
      modelMatchesCatalogQuery({
        model: modelOption("gpt-next"),
        providerLabel: "Codex",
        query: "   ",
      }),
    ).toBe(true);
  });

  it("matches the upstream provider's display name", () => {
    const model = {
      ...modelOption("opencode/claude-fable-5"),
      label: "Claude Fable 5",
      subtitle: "OpenCode Zen",
    };

    expect(modelMatchesCatalogQuery({ model, providerLabel: "OpenCode", query: " ZEN " })).toBe(
      true,
    );
    expect(modelMatchesCatalogQuery({ model, providerLabel: "OpenCode", query: "copilot" })).toBe(
      false,
    );
  });

  it("highlights the canonical OMP default for a legacy applied selection", () => {
    const option = {
      ...modelOption("default"),
      providerDriver: "ohMyPi" as const,
    };

    expect(
      modelIsDisplayed({
        pending: null,
        option,
        providerDriver: "ohMyPi",
        current: { ...option.selection, model: "oh-my-pi-default" },
      }),
    ).toBe(true);
  });

  it("keeps equivalent OMP defaults as an applied no-op", () => {
    const option = {
      ...modelOption("default"),
      providerDriver: "ohMyPi" as const,
    };
    const current = { ...option.selection, model: "oh-my-pi-default" };
    const displayed = modelIsDisplayed({
      pending: null,
      option,
      providerDriver: "ohMyPi",
      current,
    });

    expect(displayed).toBe(true);
    expect(
      pendingModelAfterPress({ current: null, pressed: option, pressedIsApplied: displayed }),
    ).toBeNull();
  });

  it("gives a staged different role display precedence", () => {
    const applied = {
      ...modelOption("default"),
      providerDriver: "ohMyPi" as const,
    };
    const pending = { ...modelOption("slow"), providerDriver: "ohMyPi" as const };
    const current = { ...applied.selection, model: "oh-my-pi-default" };

    expect(modelIsDisplayed({ pending, option: applied, providerDriver: "ohMyPi", current })).toBe(
      false,
    );
    expect(modelIsDisplayed({ pending, option: pending, providerDriver: "ohMyPi", current })).toBe(
      true,
    );
  });

  it("preserves the provider boundary for default aliases", () => {
    const option = modelOption("default");

    expect(
      modelIsDisplayed({
        pending: null,
        option,
        providerDriver: "codex",
        current: { ...option.selection, model: "oh-my-pi-default" },
      }),
    ).toBe(false);
  });

  it("clears staging when the applied model is pressed", () => {
    expect(
      pendingModelAfterPress({
        current: modelOption("gpt-next"),
        pressed: modelOption("gpt-current"),
        pressedIsApplied: true,
      }),
    ).toBeNull();
  });

  it("preserves staged options when the highlighted model is pressed again", () => {
    const pending = modelOption("gpt-next", [{ id: "effort", value: "high" }]);

    expect(
      pendingModelAfterPress({
        current: pending,
        pressed: modelOption("gpt-next"),
        pressedIsApplied: false,
      }),
    ).toBe(pending);
  });

  it("stages a different model", () => {
    const pressed = modelOption("gpt-other");

    expect(
      pendingModelAfterPress({
        current: modelOption("gpt-next"),
        pressed,
        pressedIsApplied: false,
      }),
    ).toBe(pressed);
  });

  it("cannot save a staged model after sign-out removes it from the catalog", () => {
    const pending = modelOption("gemini-native");
    const group = { providerKey: "codex", providerLabel: "Codex", models: [pending] };

    expect(canCommitPendingModel(pending, [group])).toBe(true);
    expect(canCommitPendingModel(pending, [])).toBe(false);
    expect(
      canCommitPendingModel(pending, [
        {
          ...group,
          models: [{ ...pending, isUnavailable: true }],
        },
      ]),
    ).toBe(false);
  });

  it("blocks a different role for a started provider that binds roles to threads", () => {
    expect(
      startedThreadModelChangeBlockReason({
        hasStartedSession: true,
        requiresNewThreadForModelChange: true,
        providerDriver: "ohMyPi",
        current: modelOption("default").selection,
        next: modelOption("slow").selection,
      }),
    ).toBe("This provider fixes the role after a conversation has started.");
  });

  it("allows role choices before the provider session starts", () => {
    expect(
      startedThreadModelChangeBlockReason({
        hasStartedSession: false,
        requiresNewThreadForModelChange: true,
        providerDriver: "ohMyPi",
        current: modelOption("default").selection,
        next: modelOption("slow").selection,
      }),
    ).toBeNull();
  });

  it("allows the current role and the OMP legacy-default equivalent", () => {
    const input = {
      hasStartedSession: true,
      requiresNewThreadForModelChange: true,
      providerDriver: "ohMyPi",
      current: modelOption("oh-my-pi-default").selection,
    } as const;

    expect(
      startedThreadModelChangeBlockReason({
        ...input,
        next: modelOption("oh-my-pi-default").selection,
      }),
    ).toBeNull();
    expect(
      startedThreadModelChangeBlockReason({ ...input, next: modelOption("default").selection }),
    ).toBeNull();
  });

  it("does not equate the OMP sentinel and default for other providers", () => {
    expect(
      startedThreadModelChangeBlockReason({
        hasStartedSession: true,
        requiresNewThreadForModelChange: true,
        providerDriver: "codex",
        current: modelOption("oh-my-pi-default").selection,
        next: modelOption("default").selection,
      }),
    ).toBe("This provider fixes the role after a conversation has started.");
  });
});
