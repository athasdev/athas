import { EditorSelection, type Text } from "@codemirror/state";
import { useEffect, useRef } from "react";
import { editorAPI } from "../../../extensions/api";
import { LspClient } from "../../../lsp/lsp-client";
import type { CodeMirrorHost } from "../host";
import {
  clearActiveCodeMirrorNavigation,
  setActiveCodeMirrorNavigation,
} from "@/features/editor/services/active-editor-navigation";
import { toLspPosition } from "../navigation/lsp-document";
import {
  expandSelectionTarget,
  flattenSelectionRanges,
  type OffsetRange,
} from "../navigation/selection-ranges";

interface SelectionSession {
  doc: Text;
  ranges: OffsetRange[];
  /** Selections Expand moved away from, for Shrink to walk back through. */
  history: OffsetRange[];
}

/**
 * Lets the keymap's Expand/Shrink Selection use the language server's selection ranges in this
 * editor, and Peek References open the inline peek, while it is the focused surface.
 */
export function useActiveNavigation(
  host: CodeMirrorHost,
  lspEnabled: boolean,
  peekAtCursor: () => Promise<void>,
) {
  const { view, isActiveSurface, filePath } = host;
  const session = useRef<SelectionSession | null>(null);
  const ownerId = host.viewStateKey ?? host.bufferId;

  useEffect(() => {
    if (!isActiveSurface || !lspEnabled) return;

    const select = (range: OffsetRange) => {
      view.dispatch({
        selection: EditorSelection.single(range.from, range.to),
        scrollIntoView: true,
        userEvent: "select",
      });
    };

    const currentSession = () => {
      const current = session.current;
      if (!current || current.doc !== view.state.doc) return null;
      return current;
    };

    const expand = async () => {
      const { main } = view.state.selection;
      const selection = { from: main.from, to: main.to };
      let current = currentSession();
      const cached = current && expandSelectionTarget(current.ranges, selection);
      if (current && cached) {
        current.history.push(selection);
        select(cached);
        return;
      }
      const doc = view.state.doc;
      const position = toLspPosition(doc, main.empty ? main.head : main.from);
      const [result] = await LspClient.getInstance().getSelectionRanges(filePath, [position]);
      if (view.state.doc !== doc) return;
      const ranges = flattenSelectionRanges(doc, result);
      const target = expandSelectionTarget(ranges, selection);
      if (!target) {
        editorAPI.expandSelection();
        return;
      }
      current = currentSession();
      session.current = {
        doc,
        ranges,
        history: current ? [...current.history, selection] : [selection],
      };
      select(target);
    };

    const shrink = () => {
      const current = currentSession();
      const { main } = view.state.selection;
      const inside = (range: OffsetRange) =>
        range.from >= main.from &&
        range.to <= main.to &&
        (range.from > main.from || range.to < main.to);
      let previous = current?.history.pop();
      while (previous && !inside(previous)) previous = current?.history.pop();
      if (previous) select(previous);
      else editorAPI.shrinkSelection();
    };

    setActiveCodeMirrorNavigation({
      ownerId,
      expandSelection: () => {
        void expand();
        return true;
      },
      shrinkSelection: () => {
        shrink();
        return true;
      },
      peekReferences: () => {
        void peekAtCursor();
        return true;
      },
    });
    return () => clearActiveCodeMirrorNavigation(ownerId);
  }, [filePath, isActiveSurface, lspEnabled, ownerId, peekAtCursor, view]);
}
