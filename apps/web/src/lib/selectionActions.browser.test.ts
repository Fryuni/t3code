import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers } from "../../test/render";
import { observeSelectionActions, SELECTION_MULTI_CLICK_INTERVAL_MS } from "./selectionActions";

describe("observeSelectionActions", () => {
  it.each([
    { immediateMultiClick: false, nextFrame: [], afterInterval: [[{ x: 40, y: 12 }]] },
    { immediateMultiClick: true, nextFrame: [[null]], afterInterval: [[null]] },
  ])(
    "double-click with immediateMultiClick=$immediateMultiClick",
    ({ immediateMultiClick, nextFrame, afterInterval }) => {
      using stack = new DisposableStack();
      const element = stack.adopt(document.body.appendChild(document.createElement("div")), (e) =>
        e.remove(),
      );
      stack.use(fakeTimers());
      const onSelection = vi.fn();
      const actions = observeSelectionActions({
        element,
        immediateMultiClick,
        onSelection,
        onDismiss: () => {},
      });
      stack.defer(() => actions.dispose());

      element.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, button: 0 }),
      );
      element.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          detail: 2,
          clientX: 40,
          clientY: 12,
        }),
      );

      vi.advanceTimersByTime(20);
      expect(onSelection.mock.calls).toEqual(nextFrame);
      vi.advanceTimersByTime(SELECTION_MULTI_CLICK_INTERVAL_MS - 21);
      expect(onSelection.mock.calls).toEqual(nextFrame);
      vi.advanceTimersByTime(50);
      expect(onSelection.mock.calls).toEqual(afterInterval);
    },
  );

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
