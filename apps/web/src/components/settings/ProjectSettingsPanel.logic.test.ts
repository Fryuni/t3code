import { describe, expect, it } from "vite-plus/test";

import { projectCheckoutOptions, projectGroupTitleNeedsUpdate } from "./ProjectSettingsPanel.logic";

describe("projectGroupTitleNeedsUpdate", () => {
  it("updates divergent member titles even when the next title is the derived group label", () => {
    expect(
      projectGroupTitleNeedsUpdate(["local-title", "remote-title"], "Repository name", true),
    ).toBe(true);
  });

  it("skips an untouched blur when the derived label differs from member titles", () => {
    expect(projectGroupTitleNeedsUpdate(["repo-slug", "repo-slug"], "Repository Name", false)).toBe(
      false,
    );
  });

  it("skips an update when every member already has the next title", () => {
    expect(projectGroupTitleNeedsUpdate(["Shared name", "Shared name"], "Shared name", true)).toBe(
      false,
    );
  });
});

describe("projectCheckoutOptions", () => {
  const laptop = { environmentId: "laptop" };
  const server = { environmentId: "server" };
  const options = (overrides: Partial<Parameters<typeof projectCheckoutOptions>[0]> = {}) =>
    projectCheckoutOptions({
      connectedEnvironments: [laptop, server],
      checkoutEnvironmentIds: ["laptop"],
      checkoutCount: 1,
      canCheckOut: true,
      ...overrides,
    });

  it("offers connected machines without a checkout", () => {
    expect(options()).toEqual({ visible: true, targets: [server] });
  });

  it("offers no machine once every connected one has a checkout", () => {
    expect(options({ checkoutEnvironmentIds: ["laptop", "server"], checkoutCount: 2 })).toEqual({
      visible: true,
      targets: [],
    });
  });

  it("hides the section when only one machine is connected", () => {
    expect(options({ connectedEnvironments: [laptop] })).toEqual({
      visible: false,
      targets: [],
    });
  });

  it("keeps listing several checkouts when only one machine is connected", () => {
    expect(
      options({
        connectedEnvironments: [laptop],
        checkoutEnvironmentIds: ["laptop", "laptop"],
        checkoutCount: 2,
      }).visible,
    ).toBe(true);
  });

  it("offers nothing for projects that cannot be checked out", () => {
    expect(options({ canCheckOut: false }).targets).toEqual([]);
  });
});
