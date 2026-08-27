import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { ContextMenuPopup } from "@/ui/context-menu";
import {
  buildEditorContextMenuGroups,
  type EditorContextMenuHandlers,
} from "./editor-context-menu-items";

interface EditorContextMenuProps extends EditorContextMenuHandlers {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
}

const EditorContextMenu = ({ isOpen, position, onClose, ...handlers }: EditorContextMenuProps) => {
  const hasSelection = (() => {
    if (!isOpen) return false;
    const selection = useEditorStateStore.getState().selection;
    return Boolean(selection && selection.start.offset !== selection.end.offset);
  })();
  if (!isOpen) return null;

  const groups = buildEditorContextMenuGroups({
    hasSelection,
    ...handlers,
  });

  return <ContextMenuPopup isOpen={isOpen} point={position} groups={groups} onClose={onClose} />;
};

export default EditorContextMenu;
