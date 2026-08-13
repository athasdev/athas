import {
  TextAlignLeftIcon as AlignLeft,
  BookmarkIcon as Bookmark,
  TextAaIcon as CaseSensitive,
  CaretDownIcon as ChevronDown,
  CaretUpIcon as ChevronUp,
  ClipboardTextIcon as ClipboardPaste,
  CodeIcon as Code,
  CopyIcon as Copy,
  FileTextIcon as FileText,
  TextIndentIcon as Indent,
  TextOutdentIcon as Outdent,
  PencilLineIcon as PenLine,
  ArrowCounterClockwiseIcon as RotateCcw,
  ScissorsIcon as Scissors,
  MagnifyingGlassIcon as Search,
  TrashIcon as Trash2,
  TextTIcon as Type,
} from "@/ui/icons";
import { menuSeparator, type MenuItem } from "@/ui/dropdown";

export interface EditorContextMenuHandlers {
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onSelectAll?: () => void;
  onFind?: () => void;
  onGoToLine?: () => void;
  onGoToDefinition?: () => void;
  onGoToTypeDefinition?: () => void;
  onFindReferences?: () => void;
  onRenameSymbol?: () => void;
  onSelectNextOccurrence?: () => void;
  onSelectAllOccurrences?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onIndent?: () => void;
  onOutdent?: () => void;
  onToggleComment?: () => void;
  onFormat?: () => void;
  onFormatSelection?: () => void;
  onTriggerSuggest?: () => void;
  onShowHover?: () => void;
  onQuickFix?: () => void;
  onToggleCase?: () => void;
  onMoveLineUp?: () => void;
  onMoveLineDown?: () => void;
  onToggleBookmark?: () => void;
}

export interface EditorContextMenuItemOptions extends EditorContextMenuHandlers {
  hasSelection: boolean;
}

function isDisabled(handler: (() => void) | undefined, disabled = false): boolean {
  return disabled || !handler;
}

export function buildEditorContextMenuItems({
  hasSelection,
  onCopy,
  onCut,
  onPaste,
  onSelectAll,
  onFind,
  onGoToLine,
  onGoToDefinition,
  onGoToTypeDefinition,
  onFindReferences,
  onRenameSymbol,
  onSelectNextOccurrence,
  onSelectAllOccurrences,
  onDelete,
  onDuplicate,
  onIndent,
  onOutdent,
  onToggleComment,
  onFormat,
  onFormatSelection,
  onTriggerSuggest,
  onShowHover,
  onQuickFix,
  onToggleCase,
  onMoveLineUp,
  onMoveLineDown,
  onToggleBookmark,
}: EditorContextMenuItemOptions): MenuItem[] {
  return [
    {
      id: "copy",
      label: "Copy",
      icon: <Copy />,
      shortcut: "cmd+c",
      disabled: isDisabled(onCopy, !hasSelection),
      onClick: onCopy,
    },
    {
      id: "cut",
      label: "Cut",
      icon: <Scissors />,
      shortcut: "cmd+x",
      disabled: isDisabled(onCut, !hasSelection),
      onClick: onCut,
    },
    {
      id: "paste",
      label: "Paste",
      icon: <ClipboardPaste />,
      shortcut: "cmd+v",
      disabled: isDisabled(onPaste),
      onClick: onPaste,
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 />,
      shortcut: "delete",
      disabled: isDisabled(onDelete, !hasSelection),
      onClick: onDelete,
    },
    menuSeparator("sep-1"),
    {
      id: "select-all",
      label: "Select All",
      icon: <Type />,
      shortcut: "cmd+a",
      disabled: isDisabled(onSelectAll),
      onClick: onSelectAll,
    },
    {
      id: "duplicate",
      label: "Duplicate Line",
      icon: <FileText />,
      disabled: isDisabled(onDuplicate),
      onClick: onDuplicate,
    },
    {
      id: "select-next-occurrence",
      label: "Add Selection to Next Match",
      icon: <Search />,
      shortcut: "cmd+d",
      disabled: isDisabled(onSelectNextOccurrence),
      onClick: onSelectNextOccurrence,
    },
    {
      id: "select-all-occurrences",
      label: "Select All Occurrences",
      icon: <Search />,
      shortcut: "cmd+shift+l",
      disabled: isDisabled(onSelectAllOccurrences),
      onClick: onSelectAllOccurrences,
    },
    menuSeparator("sep-2"),
    {
      id: "toggle-comment",
      label: "Toggle Comment",
      icon: <Code />,
      shortcut: "cmd+/",
      disabled: isDisabled(onToggleComment),
      onClick: onToggleComment,
    },
    {
      id: "indent",
      label: "Indent",
      icon: <Indent />,
      shortcut: "tab",
      disabled: isDisabled(onIndent),
      onClick: onIndent,
    },
    {
      id: "outdent",
      label: "Outdent",
      icon: <Outdent />,
      shortcut: "shift+tab",
      disabled: isDisabled(onOutdent),
      onClick: onOutdent,
    },
    {
      id: "format",
      label: "Format Document",
      icon: <AlignLeft />,
      shortcut: "shift+alt+f",
      disabled: isDisabled(onFormat),
      onClick: onFormat,
    },
    {
      id: "format-selection",
      label: "Format Selection",
      icon: <AlignLeft />,
      shortcut: "cmd+k cmd+f",
      disabled: isDisabled(onFormatSelection, !hasSelection),
      onClick: onFormatSelection,
    },
    menuSeparator("sep-3"),
    {
      id: "move-up",
      label: "Move Line Up",
      icon: <ChevronUp />,
      shortcut: "alt+up",
      disabled: isDisabled(onMoveLineUp),
      onClick: onMoveLineUp,
    },
    {
      id: "move-down",
      label: "Move Line Down",
      icon: <ChevronDown />,
      shortcut: "alt+down",
      disabled: isDisabled(onMoveLineDown),
      onClick: onMoveLineDown,
    },
    {
      id: "toggle-case",
      label: "Toggle Case",
      icon: <CaseSensitive />,
      disabled: isDisabled(onToggleCase, !hasSelection),
      onClick: onToggleCase,
    },
    menuSeparator("sep-4"),
    {
      id: "go-to-definition",
      label: "Go to Definition",
      icon: <Code />,
      shortcut: "f12",
      disabled: isDisabled(onGoToDefinition),
      onClick: onGoToDefinition,
    },
    {
      id: "find-references",
      label: "Find All References",
      icon: <Search />,
      shortcut: "shift+f12",
      disabled: isDisabled(onFindReferences),
      onClick: onFindReferences,
    },
    {
      id: "go-to-type-definition",
      label: "Go to Type Definition",
      icon: <Code />,
      disabled: isDisabled(onGoToTypeDefinition),
      onClick: onGoToTypeDefinition,
    },
    {
      id: "rename-symbol",
      label: "Rename Symbol",
      icon: <PenLine />,
      shortcut: "f2",
      disabled: isDisabled(onRenameSymbol),
      onClick: onRenameSymbol,
    },
    {
      id: "quick-fix",
      label: "Quick Fix...",
      icon: <PenLine />,
      shortcut: "cmd+.",
      disabled: isDisabled(onQuickFix),
      onClick: onQuickFix,
    },
    {
      id: "show-hover",
      label: "Show Hover",
      icon: <Code />,
      shortcut: "cmd+k cmd+i",
      disabled: isDisabled(onShowHover),
      onClick: onShowHover,
    },
    {
      id: "trigger-suggest",
      label: "Trigger Suggest",
      icon: <Code />,
      shortcut: "ctrl+space",
      disabled: isDisabled(onTriggerSuggest),
      onClick: onTriggerSuggest,
    },
    menuSeparator("sep-5"),
    {
      id: "find",
      label: "Find",
      icon: <Search />,
      shortcut: "cmd+f",
      disabled: isDisabled(onFind),
      onClick: onFind,
    },
    {
      id: "go-to-line",
      label: "Go to Line",
      icon: <RotateCcw />,
      shortcut: "cmd+g",
      disabled: isDisabled(onGoToLine),
      onClick: onGoToLine,
    },
    {
      id: "bookmark",
      label: "Toggle Bookmark",
      icon: <Bookmark />,
      shortcut: "cmd+k cmd+k",
      disabled: isDisabled(onToggleBookmark),
      onClick: onToggleBookmark,
    },
  ];
}
