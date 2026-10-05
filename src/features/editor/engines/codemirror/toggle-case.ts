import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { toggleCaseText } from "../../utils/text-operations";

/**
 * Upper-cases every selection that has a lowercase letter and lower-cases the rest, keeping the
 * selections where they are. Returns false when nothing is selected.
 */
export function toggleSelectionCase(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.every((range) => range.empty)) return false;

  view.dispatch(
    state.changeByRange((range) => {
      if (range.empty) return { range };
      const text = state.sliceDoc(range.from, range.to);
      const insert = toggleCaseText(text, 0, text.length).content;
      const end = range.from + insert.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range:
          range.anchor <= range.head
            ? EditorSelection.range(range.from, end)
            : EditorSelection.range(end, range.from),
      };
    }),
    { userEvent: "input", scrollIntoView: true },
  );
  return true;
}
