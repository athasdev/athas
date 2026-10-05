import { addCursorAbove, addCursorBelow, selectAll, simplifySelection } from "@codemirror/commands";
import { openSearchPanel, selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { EditorSelection, type SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { ActiveEditorAdapter, ActiveFindAdapter } from "../../extensions/api";
import { fromEditorPosition, fromEditorRange } from "./position";

/** The shared editor API's edit and selection operations, carried out on a CodeMirror view. */
export function createCodeMirrorEditorAdapter(
  ownerId: string,
  getView: () => EditorView | null,
  history: { undo: () => void; redo: () => void },
): ActiveEditorAdapter {
  const run = (command: (view: EditorView) => boolean) => () => {
    const view = getView();
    if (view) command(view);
  };
  const replace = (range: SelectionRange, insert: string) => {
    const view = getView();
    if (!view) return;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: EditorSelection.cursor(range.from + insert.length),
      scrollIntoView: true,
      userEvent: "input",
    });
  };

  return {
    ownerId,
    insertText: (text, position) => {
      const view = getView();
      if (!view) return;
      if (position) {
        const at = fromEditorPosition(view.state.doc, position);
        replace(EditorSelection.cursor(at), text);
        return;
      }
      view.dispatch(view.state.replaceSelection(text), {
        scrollIntoView: true,
        userEvent: "input",
      });
    },
    deleteRange: (range) => {
      const view = getView();
      if (view) replace(fromEditorRange(view.state.doc, range), "");
    },
    replaceRange: (range, text) => {
      const view = getView();
      if (view) replace(fromEditorRange(view.state.doc, range), text);
    },
    selectAll: run(selectAll),
    addSelectionToNextFindMatch: run(selectNextOccurrence),
    addSelectionToPreviousFindMatch: run(selectPreviousOccurrence),
    selectAllFindMatches: run(selectSelectionMatches),
    insertCursorAbove: run(addCursorAbove),
    insertCursorBelow: run(addCursorBelow),
    insertCursorsAtLineEnds: run(insertCursorsAtLineEnds),
    removeSecondaryCursors: run(simplifySelection),
    undo: history.undo,
    redo: history.redo,
  };
}

export function createCodeMirrorFindAdapter(
  ownerId: string,
  getView: () => EditorView | null,
): ActiveFindAdapter {
  return {
    ownerId,
    openFind: (replace) => {
      const view = getView();
      if (!view) return;
      openSearchPanel(view);
      if (!replace) return;
      const field = view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]");
      field?.focus();
    },
  };
}

/**
 * Adds the previous occurrence of the main selection's text, wrapping around the document, the
 * mirror of CodeMirror's `selectNextOccurrence`.
 */
export function selectPreviousOccurrence(view: EditorView): boolean {
  const { state } = view;
  const { main, ranges } = state.selection;
  if (main.empty) return selectNextOccurrence(view);

  const text = state.sliceDoc(main.from, main.to);
  const first = Math.min(...ranges.map((range) => range.from));
  let index = state.sliceDoc(0, first).lastIndexOf(text);
  if (index === -1) {
    const last = Math.max(...ranges.map((range) => range.to));
    const found = state.sliceDoc(last).lastIndexOf(text);
    if (found === -1) return false;
    index = last + found;
  }
  if (ranges.some((range) => range.from === index)) return false;

  view.dispatch({
    selection: state.selection.addRange(EditorSelection.range(index, index + text.length)),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

/** Replaces the selection with a cursor at the end of every line it touches. */
export function insertCursorsAtLineEnds(view: EditorView): boolean {
  const { doc, selection } = view.state;
  const cursors: SelectionRange[] = [];
  for (const range of selection.ranges) {
    const startLine = doc.lineAt(range.from).number;
    const endLine = doc.lineAt(range.to).number;
    for (let number = startLine; number <= endLine; number++) {
      cursors.push(EditorSelection.cursor(doc.line(number).to));
    }
  }
  view.dispatch({ selection: EditorSelection.create(cursors), userEvent: "select" });
  return true;
}
