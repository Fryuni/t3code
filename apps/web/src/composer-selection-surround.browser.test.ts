import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { expect, it } from "vite-plus/test";

import { surroundComposerSelection } from "./composer-selection-surround";

/** An editor holding "word" fully selected; dispose it to destroy the editor and its element. */
function selectedWord() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit],
    content: "<p>word</p>",
    editorProps: {
      handleTextInput: surroundComposerSelection,
      handleScrollToSelection: () => true,
    },
  });
  editor.commands.setTextSelection({ from: 1, to: 5 });
  editor.view.focus();
  const updated = new Promise<void>((resolve) => {
    editor.on("update", () => resolve());
  });
  const text = editor.view.dom.querySelector("p")!.firstChild!;
  return {
    editor,
    text,
    updated,
    [Symbol.dispose]() {
      editor.destroy();
      element.remove();
    },
  };
}

it.each(["'", '"', "`"])(
  "replaces selected text with %s when the DOM update arrives after compositionend",
  async (quote) => {
    using word = selectedWord();
    const { editor, text, updated } = word;
    const dom = editor.view.dom;
    dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    text.nodeValue = quote;
    window.getSelection()!.collapse(text, 1);
    dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: quote }));

    // The final DOM mutation has not reached the state yet.
    expect(editor.view.composing).toBe(false);
    expect(editor.state.selection.empty).toBe(false);
    await updated;

    expect(editor.state.doc.textContent).toBe(quote);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(2);
  },
);

it("still surrounds selected text on a DOM input without composition", async () => {
  using word = selectedWord();
  const { editor, text, updated } = word;
  text.nodeValue = "(";
  window.getSelection()!.collapse(text, 1);
  await updated;

  expect(editor.state.doc.textContent).toBe("(word)");
  expect(editor.state.selection.from).toBe(2);
  expect(editor.state.selection.to).toBe(6);
});
