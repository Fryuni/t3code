import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, type ClientSettings } from "@t3tools/contracts";
import type { ChangeEvent, ReactNode } from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { __resetClientSettingsPersistenceForTests } from "~/hooks/useSettings";

const mocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence: { getClientSettings: mocks.getClientSettings } }),
}));
vi.mock("../ui/dialog", () => {
  const Container = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Container,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogPanel: Container,
    DialogPopup: Container,
    DialogTitle: Container,
  };
});
vi.mock("../ui/button", () => ({
  Button: ({ children }: { readonly children?: ReactNode }) => <button>{children}</button>,
}));
vi.mock("../ui/input", () => ({
  Input: (props: {
    readonly value: string;
    readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  }) => <input value={props.value} onChange={props.onChange} />,
}));
vi.mock("../ui/label", () => ({ Label: () => null }));
vi.mock("../ui/spinner", () => ({ Spinner: () => null }));
vi.mock("../ui/toast", () => ({ stackedThreadToast: vi.fn(), toastManager: { add: vi.fn() } }));

import { LocalhostPreviewUrlDialog } from "./LocalhostPreviewUrlDialog";

const environmentId = EnvironmentId.make("environment-1");
const savedTemplate = "https://{port}.devbox.example.dev";
let renderer: ReactTestRenderer | null = null;
let loadSettings: () => void = () => {};

const renderDialog = () =>
  act(() => {
    renderer = create(
      <LocalhostPreviewUrlDialog
        environmentId={environmentId}
        environmentLabel="Devbox"
        onClose={() => {}}
      />,
    );
  });
const input = () => renderer!.root.findByType("input");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  __resetClientSettingsPersistenceForTests();
  // Settings stay unread until the test calls `loadSettings`.
  mocks.getClientSettings.mockImplementation(
    () =>
      new Promise((resolve) => {
        loadSettings = () =>
          resolve({
            ...DEFAULT_CLIENT_SETTINGS,
            browserLocalhostUrlTemplates: { [environmentId]: savedTemplate },
          });
      }),
  );
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

describe("LocalhostPreviewUrlDialog", () => {
  it("shows a saved template that loads after the dialog opens", async () => {
    await renderDialog();
    expect(input().props.value).toBe("");

    await act(async () => loadSettings());

    expect(input().props.value).toBe(savedTemplate);
  });

  it("keeps what was typed before settings load", async () => {
    await renderDialog();
    await act(() => input().props.onChange({ target: { value: "https://{port}.other.dev" } }));

    await act(async () => loadSettings());

    expect(input().props.value).toBe("https://{port}.other.dev");
  });
});
