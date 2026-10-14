import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { selectionTouchesMentionBoundary } from "./composer-editor-mentions";
import { flatToMarkdown, pmToFlat, serializeEditorDoc } from "./composer-rich-text-doc";

const SURROUND_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "'": "'",
  '"': '"',
  "“": "”",
  "`": "`",
  "<": ">",
  "«": "»",
  "*": "*",
  _: "_",
};

/** Surrounds selected plain text with a matching quote, bracket, or formatting marker. */
export function surroundComposerSelection(
  view: Pick<EditorView, "state" | "dispatch" | "composing">,
  from: number,
  to: number,
  text: string,
) {
  // Composition replaces provisional text, sometimes after composing turns
  // false. Its replacement range is not a user selection to surround.
  if (view.composing || view.state.selection.empty || text.length !== 1) return false;
  const closer = SURROUND_CLOSE[text];
  if (!closer || from === to) return false;
  // Never wrap chips or other atoms, and never wrap styled text: the
  // default replace keeps marks intact, wrapping would drop them.
  let touchesSpecial = false;
  view.state.doc.nodesBetween(from, to, (node) => {
    if ((node.isAtom && node.isInline && !node.isText) || (node.isText && node.marks.length > 0)) {
      touchesSpecial = true;
      return false;
    }
    return true;
  });
  if (touchesSpecial) return false;
  const map = serializeEditorDoc(view.state.doc);
  const startMd = flatToMarkdown(map, pmToFlat(map, from));
  const endMd = flatToMarkdown(map, pmToFlat(map, to));
  if (selectionTouchesMentionBoundary(map.value, startMd, endMd)) return false;
  const tr = view.state.tr.insertText(closer, to).insertText(text, from);
  tr.setSelection(TextSelection.create(tr.doc, from + text.length, to + text.length));
  view.dispatch(tr);
  return true;
}
