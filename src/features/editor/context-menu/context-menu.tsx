import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { ContextMenu } from "@/ui/context-menu";
import { IS_MAC } from "@/utils/platform";
import {
  buildEditorContextMenuItems,
  type EditorContextMenuHandlers,
} from "./editor-context-menu-items";

interface EditorContextMenuProps extends EditorContextMenuHandlers {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
}

const EditorContextMenu = ({ isOpen, position, onClose, ...handlers }: EditorContextMenuProps) => {
  const selection = useEditorStateStore.use.selection?.() ?? undefined;
  const hasSelection = Boolean(selection && selection.start.offset !== selection.end.offset);
  const modifierKey = IS_MAC ? "Cmd" : "Ctrl";
  const altKey = IS_MAC ? "Option" : "Alt";

  if (!isOpen) return null;

  const items = buildEditorContextMenuItems({
    hasSelection,
    modifierKey,
    altKey,
    ...handlers,
  });

  return (
    <ContextMenu
      isOpen={isOpen}
      position={position}
      items={items}
      onClose={onClose}
      style={{ zIndex: EDITOR_CONSTANTS.Z_INDEX.CONTEXT_MENU }}
    />
  );
};

export default EditorContextMenu;
