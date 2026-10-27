import { describe, expect, it, vi } from "vite-plus/test";
import { fakeTimers } from "../../test/render";
import { observeSelectionActions } from "./selectionActions";

describe("observeSelectionActions", () => {
  it("reports a touch long-press selection that cancels the pointer", async () => {
    const element = document.createElement("div");
    element.textContent = "Select this text on a phone";
    document.body.append(element);
    const onSelection = vi.fn();
    const actions = observeSelectionActions({ element, onSelection, onDismiss: vi.fn() });
    document.addEventListener("selectionchange", actions.selectionChanged);
    using _cleanup = {
      [Symbol.dispose]: () => {
        document.removeEventListener("selectionchange", actions.selectionChanged);
        actions.dispose();
        element.remove();
      },
    };

    const touch = { bubbles: true, isPrimary: true, pointerType: "touch", button: 0 };
    element.dispatchEvent(new PointerEvent("pointerdown", touch));
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointercancel", touch));
    window.getSelection()!.selectAllChildren(element);

    await vi.waitFor(() => expect(onSelection).toHaveBeenCalledWith(null));
  });

  it("keeps a dismissed touch selection hidden when the viewport scrolls", () => {
    const element = document.createElement("div");
    element.textContent = "Select this text on a phone";
    document.body.append(element);
    const onSelection = vi.fn();
    const actions = observeSelectionActions({
      element,
      restoreAfterScroll: true,
      onSelection,
      onDismiss: vi.fn(),
    });
    using _timers = fakeTimers();
    using _cleanup = {
      [Symbol.dispose]: () => {
        actions.dispose();
        element.remove();
      },
    };

    const touch = { bubbles: true, isPrimary: true, pointerType: "touch", button: 0 };
    element.dispatchEvent(new PointerEvent("pointerdown", touch));
    window.dispatchEvent(new PointerEvent("pointercancel", touch));
    actions.selectionChanged();
    vi.advanceTimersByTime(1_000);
    expect(onSelection).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    element.dispatchEvent(new Event("scroll"));
    actions.selectionChanged();
    vi.advanceTimersByTime(1_000);
    expect(onSelection).toHaveBeenCalledTimes(1);
  });
});
