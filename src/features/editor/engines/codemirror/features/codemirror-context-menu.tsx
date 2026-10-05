import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import EditorContextMenu from "@/features/editor/context-menu/context-menu";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { toggleSelectionCase } from "../toggle-case";

interface MenuPosition {
  x: number;
  y: number;
}

function runCommand(commandId: string) {
  void keymapRegistry.executeCommand(commandId);
}

/**
 * Moves the cursor to a right click outside the selection, as Monaco does, so the menu acts on
 * what was clicked.
 */
export function placeCursorForContextMenu(view: EditorView, point: MenuPosition): void {
  const position = view.posAtCoords(point);
  if (position === null) return;
  const insideSelection = view.state.selection.ranges.some(
    (range) => range.from <= position && position <= range.to,
  );
  if (!insideSelection) {
    view.dispatch({ selection: EditorSelection.cursor(position), userEvent: "select.pointer" });
  }
}

/** The Athas editor context menu, opened by right-clicking the text. */
export function CodeMirrorContextMenu({ host }: { host: CodeMirrorHost }) {
  const { view, isReadOnly } = host;
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const extension = useMemo(
    () =>
      EditorView.domEventHandlers({
        contextmenu: (event, editorView) => {
          event.preventDefault();
          event.stopPropagation();
          const point = { x: event.clientX, y: event.clientY };
          placeCursorForContextMenu(editorView, point);
          editorView.focus();
          setPosition(point);
          return true;
        },
      }),
    [],
  );
  useCodeMirrorExtension(view, extension);

  if (!position) return null;

  const canEdit = !isReadOnly;
  const refocus = (action: () => void) => () => {
    action();
    view.focus();
  };

  return createPortal(
    <EditorContextMenu
      isOpen
      position={position}
      onClose={() => setPosition(null)}
      onCopy={() => runCommand("editor.copy")}
      onCut={canEdit ? () => runCommand("editor.cut") : undefined}
      onPaste={canEdit ? () => runCommand("editor.paste") : undefined}
      onSelectAll={() => runCommand("editor.selectAll")}
      onDelete={
        canEdit
          ? refocus(() =>
              view.dispatch(view.state.replaceSelection(""), {
                userEvent: "delete.selection",
                scrollIntoView: true,
              }),
            )
          : undefined
      }
      onFind={() => runCommand("workbench.showFind")}
      onToggleComment={canEdit ? () => runCommand("editor.toggleComment") : undefined}
      onFormat={canEdit ? () => runCommand("editor.formatDocument") : undefined}
      onFormatSelection={canEdit ? () => runCommand("editor.formatSelection") : undefined}
      onToggleCase={canEdit ? refocus(() => toggleSelectionCase(view)) : undefined}
      onGoToDefinition={() => runCommand("editor.goToDefinition")}
      onFindReferences={() => runCommand("editor.goToReferences")}
      onRenameSymbol={canEdit ? () => runCommand("editor.renameSymbol") : undefined}
      onQuickFix={canEdit ? () => runCommand("editor.quickFix") : undefined}
    />,
    document.body,
  );
}
