import {
  AlignLeft,
  Bookmark,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Code,
  Copy,
  FileText,
  Indent,
  Outdent,
  RotateCcw,
  Scissors,
  Search,
  Trash2,
  Type,
} from "lucide-react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { logger } from "@/features/editor/utils/logger";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import KeybindingBadge from "@/ui/keybinding-badge";
import { IS_MAC } from "@/utils/platform";

interface EditorContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onSelectAll?: () => void;
  onFind?: () => void;
  onGoToLine?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onIndent?: () => void;
  onOutdent?: () => void;
  onToggleComment?: () => void;
  onFormat?: () => void;
  onToggleCase?: () => void;
  onMoveLineUp?: () => void;
  onMoveLineDown?: () => void;
  onToggleBookmark?: () => void;
}

const EditorContextMenu = ({
  isOpen,
  position,
  onClose,
  onCopy,
  onCut,
  onPaste,
  onSelectAll,
  onFind,
  onGoToLine,
  onDelete,
  onDuplicate,
  onIndent,
  onOutdent,
  onToggleComment,
  onFormat,
  onToggleCase,
  onMoveLineUp,
  onMoveLineDown,
  onToggleBookmark,
}: EditorContextMenuProps) => {
  const selection = useEditorStateStore.use.selection?.() ?? undefined;
  const hasSelection = selection && selection.start.offset !== selection.end.offset;
  const modifierKey = IS_MAC ? "Cmd" : "Ctrl";
  const altKey = IS_MAC ? "Option" : "Alt";

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (onCopy) {
      onCopy();
    } else if (hasSelection && selection) {
      logger.warn("Editor", "Copy action requires parent component to handle onCopy");
    }
  };

  const items: ContextMenuItem[] = [
    {
      id: "copy",
      label: "Copy",
      icon: <Copy size={11} />,
      keybinding: <KeybindingBadge keys={[modifierKey, "C"]} className="opacity-60" />,
      disabled: !hasSelection,
      onClick: () => void handleCopy(),
    },
    {
      id: "cut",
      label: "Cut",
      icon: <Scissors size={11} />,
      keybinding: <KeybindingBadge keys={[modifierKey, "X"]} className="opacity-60" />,
      disabled: !hasSelection,
      onClick: () => onCut?.(),
    },
    {
      id: "paste",
      label: "Paste",
      icon: <ClipboardPaste size={11} />,
      keybinding: <KeybindingBadge keys={[modifierKey, "V"]} className="opacity-60" />,
      onClick: () => onPaste?.(),
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 size={11} />,
      keybinding: <KeybindingBadge keys={["Del"]} className="opacity-60" />,
      disabled: !hasSelection,
      onClick: () => onDelete?.(),
    },
    { id: "sep-1", label: "", separator: true, onClick: () => {} },
    {
      id: "select-all",
      label: "Select All",
      icon: <Type size={11} />,
      keybinding: <KeybindingBadge keys={[modifierKey, "A"]} className="opacity-60" />,
      onClick: () => onSelectAll?.(),
    },
    {
      id: "duplicate",
      label: "Duplicate Line",
      icon: <FileText size={11} />,
      keybinding: <KeybindingBadge keys={[modifierKey, "D"]} className="opacity-60" />,
      onClick: () => onDuplicate?.(),
    },
    { id: "sep-2", label: "", separator: true, onClick: () => {} },
    {
      id: "toggle-comment",
      label: "Toggle Comment",
      icon: <Code size={11} />,
      keybinding: <KeybindingBadge keys={[modifierKey, "/"]} className="opacity-60" />,
      onClick: () => onToggleComment?.(),
    },
    {
      id: "indent",
      label: "Indent",
      icon: <Indent size={11} />,
      keybinding: <KeybindingBadge keys={["Tab"]} className="opacity-60" />,
      onClick: () => onIndent?.(),
    },
    {
      id: "outdent",
      label: "Outdent",
      icon: <Outdent size={11} />,
      keybinding: <KeybindingBadge keys={["Shift", "Tab"]} className="opacity-60" />,
      onClick: () => onOutdent?.(),
    },
    {
      id: "format",
      label: "Format Document",
      icon: <AlignLeft size={11} />,
      keybinding: <KeybindingBadge keys={["Shift", altKey, "F"]} className="opacity-60" />,
      onClick: () => onFormat?.(),
    },
    { id: "sep-3", label: "", separator: true, onClick: () => {} },
    {
      id: "move-up",
      label: "Move Line Up",
      icon: <ChevronUp size={11} />,
      keybinding: <KeybindingBadge keys={[altKey, "Up"]} className="opacity-60" />,
      onClick: () => onMoveLineUp?.(),
    },
    {
      id: "move-down",
      label: "Move Line Down",
      icon: <ChevronDown size={11} />,
      keybinding: <KeybindingBadge keys={[altKey, "Down"]} className="opacity-60" />,
      onClick: () => onMoveLineDown?.(),
    },
    {
      id: "toggle-case",
      label: "Toggle Case",
      icon: <CaseSensitive size={11} />,
      disabled: !hasSelection,
      onClick: () => onToggleCase?.(),
    },
    { id: "sep-4", label: "", separator: true, onClick: () => {} },
    {
      id: "find",
      label: "Find",
      icon: <Search size={11} />,
      keybinding: <KeybindingBadge keys={[modifierKey, "F"]} className="opacity-60" />,
      onClick: () => onFind?.(),
    },
    {
      id: "go-to-line",
      label: "Go to Line",
      icon: <RotateCcw size={11} />,
      keybinding: <KeybindingBadge keys={[modifierKey, "G"]} className="opacity-60" />,
      onClick: () => onGoToLine?.(),
    },
    {
      id: "bookmark",
      label: "Toggle Bookmark",
      icon: <Bookmark size={11} />,
      keybinding: (
        <KeybindingBadge keys={[modifierKey, "K", modifierKey, "K"]} className="opacity-60" />
      ),
      onClick: () => onToggleBookmark?.(),
    },
  ];

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
