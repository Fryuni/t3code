import { EnvironmentId, ThreadId, type DiscoveredLocalServer } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { openDiscoveredPort } from "./openDiscoveredPort";

const mocks = vi.hoisted(() => ({
  templates: {} as Record<string, string>,
  ensureClientSettingsHydrated: vi.fn(async () => undefined),
  openPreviewSession: vi.fn(),
}));

vi.mock("~/hooks/useSettings", () => ({
  getClientSettings: () => ({ browserLocalhostUrlTemplates: mocks.templates }),
  ensureClientSettingsHydrated: mocks.ensureClientSettingsHydrated,
}));
vi.mock("~/state/session", () => ({
  readPreparedConnection: () => ({ httpBaseUrl: "http://127.0.0.1:41234/" }),
}));
vi.mock("./openPreviewSession", () => ({ openPreviewSession: mocks.openPreviewSession }));
vi.mock("~/browserHistoryStore", () => ({ recordVisitForThread: vi.fn() }));
vi.mock("~/rightPanelStore", () => ({
  useRightPanelStore: { getState: () => ({ openBrowser: vi.fn() }) },
}));

const environmentId = EnvironmentId.make("environment-1");
const port: DiscoveredLocalServer = {
  host: "localhost",
  port: 5173,
  url: "http://localhost:5173/app",
  processName: "vite",
  pid: 1234,
  terminal: null,
};

describe("openDiscoveredPort", () => {
  it("opens through a localhost template that finishes loading after the click", async () => {
    mocks.ensureClientSettingsHydrated.mockImplementationOnce(async () => {
      mocks.templates = { [environmentId]: "https://{port}.devbox.example.dev" };
    });
    // Stop right after the open: the URL it was given is what matters.
    mocks.openPreviewSession.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Open stopped"))),
    );

    await openDiscoveredPort({
      threadRef: { environmentId, threadId: ThreadId.make("thread-1") },
      port,
      openPreview: vi.fn(),
    });

    expect(mocks.openPreviewSession).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://5173.devbox.example.dev/app" }),
    );
  });
});
