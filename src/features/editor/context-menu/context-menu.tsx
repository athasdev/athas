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
  PenLine,
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
import Keybinding from "@/ui/keybinding";
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
  onGoToDefinition?: () => void;
  onFindReferences?: () => void;
  onRenameSymbol?: () => void;
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
  onGoToDefinition,
  onFindReferences,
  onRenameSymbol,
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
      icon: <Copy />,
      keybinding: <Keybinding keys={[modifierKey, "C"]} className="opacity-60" />,
      disabled: !hasSelection,
      onClick: () => void handleCopy(),
    },
    {
      id: "cut",
      label: "Cut",
      icon: <Scissors />,
      keybinding: <Keybinding keys={[modifierKey, "X"]} className="opacity-60" />,
      disabled: !hasSelection,
      onClick: () => onCut?.(),
    },
    {
      id: "paste",
      label: "Paste",
      icon: <ClipboardPaste />,
      keybinding: <Keybinding keys={[modifierKey, "V"]} className="opacity-60" />,
      onClick: () => onPaste?.(),
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 />,
      keybinding: <Keybinding keys={["Del"]} className="opacity-60" />,
      disabled: !hasSelection,
      onClick: () => onDelete?.(),
    },
    { id: "sep-1", label: "", separator: true, onClick: () => {} },
    {
      id: "select-all",
      label: "Select All",
      icon: <Type />,
      keybinding: <Keybinding keys={[modifierKey, "A"]} className="opacity-60" />,
      onClick: () => onSelectAll?.(),
    },
    {
      id: "duplicate",
      label: "Duplicate Line",
      icon: <FileText />,
      keybinding: <Keybinding keys={[modifierKey, "D"]} className="opacity-60" />,
      onClick: () => onDuplicate?.(),
    },
    { id: "sep-2", label: "", separator: true, onClick: () => {} },
    {
      id: "toggle-comment",
      label: "Toggle Comment",
      icon: <Code />,
      keybinding: <Keybinding keys={[modifierKey, "/"]} className="opacity-60" />,
      onClick: () => onToggleComment?.(),
    },
    {
      id: "indent",
      label: "Indent",
      icon: <Indent />,
      keybinding: <Keybinding keys={["Tab"]} className="opacity-60" />,
      onClick: () => onIndent?.(),
    },
    {
      id: "outdent",
      label: "Outdent",
      icon: <Outdent />,
      keybinding: <Keybinding keys={["Shift", "Tab"]} className="opacity-60" />,
      onClick: () => onOutdent?.(),
    },
    {
      id: "format",
      label: "Format Document",
      icon: <AlignLeft />,
      keybinding: <Keybinding keys={["Shift", altKey, "F"]} className="opacity-60" />,
      onClick: () => onFormat?.(),
    },
    { id: "sep-3", label: "", separator: true, onClick: () => {} },
    {
      id: "move-up",
      label: "Move Line Up",
      icon: <ChevronUp />,
      keybinding: <Keybinding keys={[altKey, "Up"]} className="opacity-60" />,
      onClick: () => onMoveLineUp?.(),
    },
    {
      id: "move-down",
      label: "Move Line Down",
      icon: <ChevronDown />,
      keybinding: <Keybinding keys={[altKey, "Down"]} className="opacity-60" />,
      onClick: () => onMoveLineDown?.(),
    },
    {
      id: "toggle-case",
      label: "Toggle Case",
      icon: <CaseSensitive />,
      disabled: !hasSelection,
      onClick: () => onToggleCase?.(),
    },
    { id: "sep-4", label: "", separator: true, onClick: () => {} },
    {
      id: "go-to-definition",
      label: "Go to Definition",
      icon: <Code />,
      keybinding: <Keybinding keys={["F12"]} className="opacity-60" />,
      onClick: () => onGoToDefinition?.(),
    },
    {
      id: "find-references",
      label: "Find All References",
      icon: <Search />,
      keybinding: <Keybinding keys={["Shift", "F12"]} className="opacity-60" />,
      onClick: () => onFindReferences?.(),
    },
    {
      id: "rename-symbol",
      label: "Rename Symbol",
      icon: <PenLine />,
      keybinding: <Keybinding keys={["F2"]} className="opacity-60" />,
      onClick: () => onRenameSymbol?.(),
    },
    { id: "sep-5", label: "", separator: true, onClick: () => {} },
    {
      id: "find",
      label: "Find",
      icon: <Search />,
      keybinding: <Keybinding keys={[modifierKey, "F"]} className="opacity-60" />,
      onClick: () => onFind?.(),
    },
    {
      id: "go-to-line",
      label: "Go to Line",
      icon: <RotateCcw />,
      keybinding: <Keybinding keys={[modifierKey, "G"]} className="opacity-60" />,
      onClick: () => onGoToLine?.(),
    },
    {
      id: "bookmark",
      label: "Toggle Bookmark",
      icon: <Bookmark />,
      keybinding: <Keybinding keys={[modifierKey, "K", modifierKey, "K"]} className="opacity-60" />,
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
