import {
  TextAlignLeft as AlignLeft,
  Bookmark,
  TextAa as CaseSensitive,
  CaretDown as ChevronDown,
  CaretUp as ChevronUp,
  ClipboardText as ClipboardPaste,
  Code,
  Copy,
  FileText,
  TextIndent as Indent,
  TextOutdent as Outdent,
  PencilLine as PenLine,
  ArrowCounterClockwise as RotateCcw,
  Scissors,
  MagnifyingGlass as Search,
  Trash as Trash2,
  TextT as Type,
} from "@phosphor-icons/react";
import type { ContextMenuItem } from "@/ui/context-menu";
import Keybinding from "@/ui/keybinding";

export interface EditorContextMenuHandlers {
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

export interface EditorContextMenuItemOptions extends EditorContextMenuHandlers {
  hasSelection: boolean;
  modifierKey: string;
  altKey: string;
}

const noop = () => {};

function separator(id: string): ContextMenuItem {
  return { id, label: "", separator: true, onClick: noop };
}

function isDisabled(handler: (() => void) | undefined, disabled = false): boolean {
  return disabled || !handler;
}

export function buildEditorContextMenuItems({
  hasSelection,
  modifierKey,
  altKey,
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
}: EditorContextMenuItemOptions): ContextMenuItem[] {
  return [
    {
      id: "copy",
      label: "Copy",
      icon: <Copy />,
      keybinding: <Keybinding keys={[modifierKey, "C"]} className="opacity-60" />,
      disabled: isDisabled(onCopy, !hasSelection),
      onClick: onCopy ?? noop,
    },
    {
      id: "cut",
      label: "Cut",
      icon: <Scissors />,
      keybinding: <Keybinding keys={[modifierKey, "X"]} className="opacity-60" />,
      disabled: isDisabled(onCut, !hasSelection),
      onClick: onCut ?? noop,
    },
    {
      id: "paste",
      label: "Paste",
      icon: <ClipboardPaste />,
      keybinding: <Keybinding keys={[modifierKey, "V"]} className="opacity-60" />,
      disabled: isDisabled(onPaste),
      onClick: onPaste ?? noop,
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 />,
      keybinding: <Keybinding keys={["Del"]} className="opacity-60" />,
      disabled: isDisabled(onDelete, !hasSelection),
      onClick: onDelete ?? noop,
    },
    separator("sep-1"),
    {
      id: "select-all",
      label: "Select All",
      icon: <Type />,
      keybinding: <Keybinding keys={[modifierKey, "A"]} className="opacity-60" />,
      disabled: isDisabled(onSelectAll),
      onClick: onSelectAll ?? noop,
    },
    {
      id: "duplicate",
      label: "Duplicate Line",
      icon: <FileText />,
      keybinding: <Keybinding keys={[modifierKey, "D"]} className="opacity-60" />,
      disabled: isDisabled(onDuplicate),
      onClick: onDuplicate ?? noop,
    },
    separator("sep-2"),
    {
      id: "toggle-comment",
      label: "Toggle Comment",
      icon: <Code />,
      keybinding: <Keybinding keys={[modifierKey, "/"]} className="opacity-60" />,
      disabled: isDisabled(onToggleComment),
      onClick: onToggleComment ?? noop,
    },
    {
      id: "indent",
      label: "Indent",
      icon: <Indent />,
      keybinding: <Keybinding keys={["Tab"]} className="opacity-60" />,
      disabled: isDisabled(onIndent),
      onClick: onIndent ?? noop,
    },
    {
      id: "outdent",
      label: "Outdent",
      icon: <Outdent />,
      keybinding: <Keybinding keys={["Shift", "Tab"]} className="opacity-60" />,
      disabled: isDisabled(onOutdent),
      onClick: onOutdent ?? noop,
    },
    {
      id: "format",
      label: "Format Document",
      icon: <AlignLeft />,
      keybinding: <Keybinding keys={["Shift", altKey, "F"]} className="opacity-60" />,
      disabled: isDisabled(onFormat),
      onClick: onFormat ?? noop,
    },
    separator("sep-3"),
    {
      id: "move-up",
      label: "Move Line Up",
      icon: <ChevronUp />,
      keybinding: <Keybinding keys={[altKey, "Up"]} className="opacity-60" />,
      disabled: isDisabled(onMoveLineUp),
      onClick: onMoveLineUp ?? noop,
    },
    {
      id: "move-down",
      label: "Move Line Down",
      icon: <ChevronDown />,
      keybinding: <Keybinding keys={[altKey, "Down"]} className="opacity-60" />,
      disabled: isDisabled(onMoveLineDown),
      onClick: onMoveLineDown ?? noop,
    },
    {
      id: "toggle-case",
      label: "Toggle Case",
      icon: <CaseSensitive />,
      disabled: isDisabled(onToggleCase, !hasSelection),
      onClick: onToggleCase ?? noop,
    },
    separator("sep-4"),
    {
      id: "go-to-definition",
      label: "Go to Definition",
      icon: <Code />,
      keybinding: <Keybinding keys={["F12"]} className="opacity-60" />,
      disabled: isDisabled(onGoToDefinition),
      onClick: onGoToDefinition ?? noop,
    },
    {
      id: "find-references",
      label: "Find All References",
      icon: <Search />,
      keybinding: <Keybinding keys={["Shift", "F12"]} className="opacity-60" />,
      disabled: isDisabled(onFindReferences),
      onClick: onFindReferences ?? noop,
    },
    {
      id: "rename-symbol",
      label: "Rename Symbol",
      icon: <PenLine />,
      keybinding: <Keybinding keys={["F2"]} className="opacity-60" />,
      disabled: isDisabled(onRenameSymbol),
      onClick: onRenameSymbol ?? noop,
    },
    separator("sep-5"),
    {
      id: "find",
      label: "Find",
      icon: <Search />,
      keybinding: <Keybinding keys={[modifierKey, "F"]} className="opacity-60" />,
      disabled: isDisabled(onFind),
      onClick: onFind ?? noop,
    },
    {
      id: "go-to-line",
      label: "Go to Line",
      icon: <RotateCcw />,
      keybinding: <Keybinding keys={[modifierKey, "G"]} className="opacity-60" />,
      disabled: isDisabled(onGoToLine),
      onClick: onGoToLine ?? noop,
    },
    {
      id: "bookmark",
      label: "Toggle Bookmark",
      icon: <Bookmark />,
      keybinding: <Keybinding keys={[modifierKey, "K", modifierKey, "K"]} className="opacity-60" />,
      disabled: isDisabled(onToggleBookmark),
      onClick: onToggleBookmark ?? noop,
    },
  ];
}
