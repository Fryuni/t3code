import { describe, expect, it } from "@effect/vitest";
import {
  OH_MY_PI_SESSION_OPTION_DESCRIPTORS,
  OH_MY_PI_SESSION_OPTION_IDS,
  ohMyPiConfigOverlay,
  ohMyPiLaunchArgs,
  resolveOhMyPiSessionToggles,
} from "./OhMyPiSessionOptions.ts";

describe("OhMyPi session options", () => {
  it("treats absent and false selections as off", () => {
    expect(resolveOhMyPiSessionToggles(undefined)).toEqual({
      advisor: false,
      computerUse: false,
      prewalk: false,
    });
    expect(
      resolveOhMyPiSessionToggles([
        { id: "advisor", value: false },
        { id: "computerUse", value: true },
        { id: "thinking", value: "high" },
      ]),
    ).toEqual({ advisor: false, computerUse: true, prewalk: false });
  });

  it("states every toggle explicitly at launch", () => {
    const off = resolveOhMyPiSessionToggles([]);
    expect(ohMyPiConfigOverlay(off)).toEqual({
      fileName: "advisor-off.computer-off.yml",
      contents: "advisor:\n  enabled: false\ncomputer:\n  enabled: false\n",
    });
    expect(ohMyPiLaunchArgs({ toggles: off, overlayPath: "/tmp/off.yml" })).toEqual([
      "--no-prewalk",
      "--config",
      "/tmp/off.yml",
    ]);

    const on = resolveOhMyPiSessionToggles([
      { id: "advisor", value: true },
      { id: "computerUse", value: true },
      { id: "prewalk", value: true },
    ]);
    expect(ohMyPiConfigOverlay(on)).toEqual({
      fileName: "advisor-on.computer-on.yml",
      contents: "advisor:\n  enabled: true\ncomputer:\n  enabled: true\n",
    });
    expect(ohMyPiLaunchArgs({ toggles: on, overlayPath: "/tmp/on.yml" })).toEqual([
      "--prewalk",
      "--config",
      "/tmp/on.yml",
    ]);
  });

  it("lists exactly the launch-time descriptors as restart options", () => {
    expect(OH_MY_PI_SESSION_OPTION_IDS).toEqual(["advisor", "computerUse", "prewalk"]);
    expect(OH_MY_PI_SESSION_OPTION_DESCRIPTORS.every((d) => d.type === "boolean")).toBe(true);
  });
});
