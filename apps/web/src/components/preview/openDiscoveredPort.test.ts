import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type DiscoveredLocalServer,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as browserDefaults from "~/browser/browserDefaults";
import { getBrowserDefaults } from "~/browser/browserDefaults";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { resetPreviewStateForTests } from "~/previewStateStore";

import { openDiscoveredPort } from "./openDiscoveredPort";

const environmentId = EnvironmentId.make("environment-1");
const threadRef = { environmentId, threadId: ThreadId.make("thread-1") };
const port: DiscoveredLocalServer = {
  host: "localhost",
  port: 5173,
  url: "http://localhost:5173/app",
  processName: "vite",
  pid: 1234,
  terminal: null,
};
const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab-1",
  navStatus: { _tag: "Loading", url: "https://5173.devbox.example.dev/app", title: "" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-06T12:00:00.000Z",
};

beforeEach(() => {
  resetPreviewStateForTests();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openDiscoveredPort", () => {
  it("opens through a localhost template that a retried settings read loads", async () => {
    vi.spyOn(browserDefaults, "resolveBrowserDefaults")
      .mockRejectedValueOnce(new Error("Settings read failed"))
      .mockImplementationOnce(async () => {
        __setClientSettingsForTests({
          ...DEFAULT_CLIENT_SETTINGS,
          browserLocalhostUrlTemplates: { [environmentId]: "https://{port}.devbox.example.dev" },
        });
        return getBrowserDefaults();
      });
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    const input = { threadRef, port, openPreview };

    await expect(openDiscoveredPort(input)).resolves.toMatchObject({ _tag: "Failure" });
    expect(openPreview).not.toHaveBeenCalled();

    await expect(openDiscoveredPort(input)).resolves.toMatchObject({ _tag: "Success" });
    expect(openPreview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        input: expect.objectContaining({ url: "https://5173.devbox.example.dev/app" }),
      }),
    );
  });
});
