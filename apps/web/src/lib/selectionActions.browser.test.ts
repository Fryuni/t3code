import { describe, expect, it, vi } from "vite-plus/test";
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
});
