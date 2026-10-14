import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vite-plus/test";

import { surroundComposerSelection } from "./composer-selection-surround";

const schema = getSchema([StarterKit]);

function composer(text: string, composing = false) {
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text(text)])]),
  });
  state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
  const view = {
    get state() {
      return state;
    },
    composing,
    dispatch(tr: Transaction) {
      state = state.apply(tr);
    },
  };
  return {
    view,
    // ProseMirror offers a DOM text replacement to handleTextInput before
    // applying its default insertion, including replacements from composition.
    input(from: number, to: number, input: string) {
      if (!surroundComposerSelection(view, from, to, input)) {
        view.dispatch(state.tr.insertText(input, from, to));
      }
    },
  };
}

describe("composer selection surround", () => {
  for (const composing of [true, false]) {
    it.each(["'", '"', "`"])(
      `commits a single dead-key %s with a normal caret (composing=${composing})`,
      (quote) => {
        // A quote dead key followed by Space replaces its provisional quote.
        // The replacement range is nonempty even though the caret is collapsed.
        const editor = composer(quote, composing);
        editor.input(1, 2, quote);

        expect(editor.view.state.doc.textContent).toBe(quote);
        expect(editor.view.state.selection.empty).toBe(true);
        expect(editor.view.state.selection.from).toBe(2);

        editor.view.composing = false;
        editor.input(2, 2, "x");
        expect(editor.view.state.doc.textContent).toBe(`${quote}x`);
        expect(editor.view.state.selection.empty).toBe(true);
        expect(editor.view.state.selection.from).toBe(3);
      },
    );
  }

  it("leaves selected composition text to native replacement", () => {
    const editor = composer("'", true);
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 2)),
    );
    editor.input(1, 2, "'");

    expect(editor.view.state.doc.textContent).toBe("'");
    expect(editor.view.state.selection.empty).toBe(true);
    expect(editor.view.state.selection.from).toBe(2);
  });

  it.each(["é", "ü", "ñ"])("commits the composed character %s", (character) => {
    const editor = composer("´", true);
    editor.input(1, 2, character);

    expect(editor.view.state.doc.textContent).toBe(character);
    expect(editor.view.state.selection.empty).toBe(true);
    expect(editor.view.state.selection.from).toBe(2);
  });

  it.each([
    ["'", "'"],
    ['"', '"'],
    ["`", "`"],
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["*", "*"],
    ["_", "_"],
  ])("still surrounds a user selection with %s and %s", (opener, closer) => {
    const editor = composer("word");
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 5)),
    );
    editor.input(1, 5, opener);

    expect(editor.view.state.doc.textContent).toBe(`${opener}word${closer}`);
    expect(editor.view.state.selection.from).toBe(2);
    expect(editor.view.state.selection.to).toBe(6);
  });
});
