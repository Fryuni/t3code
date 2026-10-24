import {
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import { describe, expect, it } from "vite-plus/test";
import {
  backgroundActivitySharedPolicySettings,
  getChangedBrowserSettingLabels,
  hasChangedBackgroundActivitySettings,
  planProviderInstanceSync,
} from "./SettingsPanels.logic";

describe("background activity settings restore", () => {
  it("detects legacy interval values even when the structured setting is at its default", () => {
    expect(
      hasChangedBackgroundActivitySettings({
        backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
        backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
        automaticGitFetchInterval: Duration.seconds(45),
        providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      }),
    ).toBe(true);
    expect(
      hasChangedBackgroundActivitySettings({
        backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
        backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
        automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
        providerHealthRefreshInterval: Duration.minutes(7),
      }),
    ).toBe(true);
    expect(hasChangedBackgroundActivitySettings(DEFAULT_UNIFIED_SETTINGS)).toBe(false);
  });

  it("preserves advanced overrides when the shared policy changes", () => {
    const automaticGitFetchInterval = Duration.seconds(42);
    expect(
      backgroundActivitySharedPolicySettings(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          backgroundActivity: {
            schemaVersion: 1,
            profile: "custom",
            baseProfile: "balanced",
            overrides: {
              automaticGitFetchInterval,
              pauseWhenOnBattery: true,
            },
          },
        },
        "performance",
      ),
    ).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "performance",
      overrides: {
        automaticGitFetchInterval,
        pauseWhenOnBattery: true,
      },
    });
  });

  it("materializes legacy advanced overrides before changing the shared policy", () => {
    const automaticGitFetchInterval = Duration.seconds(42);
    expect(
      backgroundActivitySharedPolicySettings(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          automaticGitFetchInterval,
        },
        "battery-saver",
      ),
    ).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "battery-saver",
      overrides: {
        automaticGitFetchInterval,
      },
    });
  });
});

describe("getChangedBrowserSettingLabels", () => {
  it("counts a retained custom search URL so restore clears it", () => {
    expect(
      getChangedBrowserSettingLabels({
        ...DEFAULT_UNIFIED_SETTINGS,
        browserCustomSearchUrl: "https://search.example/?q=%s",
      }),
    ).toEqual(["Search engine"]);
  });
});

describe("planProviderInstanceSync", () => {
  const codex = ProviderDriverKind.make("codex");
  const codexId = ProviderInstanceId.make("codex");
  const target = (
    environmentId: string,
    providerInstances: Record<string, ProviderInstanceConfig>,
    textGenerationModelSelection = DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
  ) => ({
    environmentId: EnvironmentId.make(environmentId),
    settings: {
      providerInstances: providerInstances as ServerSettings["providerInstances"],
      textGenerationModelSelection,
    },
  });

  it("copies only the changed fields onto each environment's own instance", () => {
    const previous = { driver: codex, config: { binaryPath: "/a/codex", customModels: [] } };
    const next = {
      driver: codex,
      displayName: "Work",
      config: { binaryPath: "/a/codex", customModels: [{ slug: "gpt-x", name: "GPT X" }] },
    };
    const writes = planProviderInstanceSync({
      instanceId: codexId,
      previous,
      next,
      targets: [
        target("laptop", {
          codex: { driver: codex, config: { binaryPath: "/b/codex", homePath: "/b/home" } },
        }),
        // The default slot exists without explicit config.
        target("server", {}),
      ],
    });
    expect(writes.map(({ environmentId, instance }) => [environmentId, instance])).toEqual([
      [
        "laptop",
        {
          driver: codex,
          displayName: "Work",
          config: {
            binaryPath: "/b/codex",
            homePath: "/b/home",
            customModels: [{ slug: "gpt-x", name: "GPT X" }],
          },
        },
      ],
      [
        "server",
        {
          driver: codex,
          displayName: "Work",
          config: { customModels: [{ slug: "gpt-x", name: "GPT X" }] },
        },
      ],
    ]);
  });

  it("skips environments without the instance, with another driver, or already matching", () => {
    const work = ProviderInstanceId.make("codex-work");
    const next = { driver: codex, displayName: "Work" };
    expect(
      planProviderInstanceSync({
        instanceId: work,
        previous: { driver: codex },
        next,
        targets: [
          target("missing", {}),
          target("other-driver", {
            "codex-work": { driver: ProviderDriverKind.make("claudeAgent") },
          }),
          target("same", { "codex-work": next }),
        ],
      }),
    ).toEqual([]);
  });

  it("clears only the source's fields when the edit drops its whole config", () => {
    const writes = planProviderInstanceSync({
      instanceId: codexId,
      previous: { driver: codex, config: { binaryPath: "/a/codex" } },
      next: { driver: codex },
      targets: [
        target("laptop", {
          codex: { driver: codex, config: { binaryPath: "/b/codex", homePath: "/b/home" } },
        }),
      ],
    });
    expect(writes.map(({ instance }) => instance)).toEqual([
      { driver: codex, config: { homePath: "/b/home" } },
    ]);
  });

  it("applies environment variable edits by name, keeping the target's own", () => {
    const variable = (name: string, value: string, sensitive = false) => ({
      name,
      value,
      sensitive,
    });
    const writes = planProviderInstanceSync({
      instanceId: codexId,
      previous: { driver: codex, environment: [variable("A", "1"), variable("B", "1")] },
      next: { driver: codex, environment: [variable("A", "2"), variable("C", "1")] },
      targets: [
        target("laptop", {
          codex: {
            driver: codex,
            environment: [
              variable("KEY", "", true),
              variable("A", "local"),
              variable("B", "local"),
            ],
          },
        }),
      ],
    });
    expect(writes.map(({ instance }) => instance.environment)).toEqual([
      [variable("KEY", "", true), variable("A", "2"), variable("C", "1")],
    ]);
  });

  it("removes a cleared field and resets text generation that used a now-disabled instance", () => {
    const writes = planProviderInstanceSync({
      instanceId: codexId,
      previous: { driver: codex, displayName: "Work", enabled: true },
      next: { driver: codex, enabled: false },
      targets: [
        target(
          "laptop",
          { codex: { driver: codex, displayName: "Work", accentColor: "#f00" } },
          { instanceId: codexId, model: "gpt-x" },
        ),
      ],
    });
    expect(writes).toEqual([
      {
        environmentId: "laptop",
        instance: { driver: codex, accentColor: "#f00", enabled: false },
        patch: {
          textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
        },
      },
    ]);
  });
});
