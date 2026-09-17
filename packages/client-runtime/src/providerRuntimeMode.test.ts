import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveProviderRuntimeMode,
  runtimeModeOptionsForProvider,
} from "./providerRuntimeMode.ts";

const allModes = ["approval-required", "auto-accept-edits", "auto", "full-access"] as const;

describe("provider runtime modes", () => {
  it("restricts OhMyPi to full access across restored values and option entry points", () => {
    const provider = ProviderDriverKind.make("ohMyPi");

    expect(resolveProviderRuntimeMode(provider, "approval-required")).toBe("full-access");
    expect(runtimeModeOptionsForProvider(provider, allModes)).toEqual(["full-access"]);
  });

  it("preserves runtime modes for other providers", () => {
    const provider = ProviderDriverKind.make("codex");

    expect(resolveProviderRuntimeMode(provider, "approval-required")).toBe("approval-required");
    expect(runtimeModeOptionsForProvider(provider, allModes)).toBe(allModes);
  });
});
