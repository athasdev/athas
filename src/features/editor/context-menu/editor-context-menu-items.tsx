import {
  TextAlignLeftIcon as AlignLeft,
  TextAaIcon as CaseSensitive,
  ClipboardTextIcon as ClipboardPaste,
  CodeIcon as Code,
  CopyIcon as Copy,
  PencilLineIcon as PenLine,
  ScissorsIcon as Scissors,
  MagnifyingGlassIcon as Search,
  TrashIcon as Trash2,
  TextTIcon as Type,
} from "@/ui/icons";
import type { ContextMenuGroupData } from "@/ui/context-menu";

export interface EditorContextMenuHandlers {
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onSelectAll?: () => void;
  onDelete?: () => void;
  onFind?: () => void;
  onGoToDefinition?: () => void;
  onFindReferences?: () => void;
  onRenameSymbol?: () => void;
  onToggleComment?: () => void;
  onFormat?: () => void;
  onFormatSelection?: () => void;
  onQuickFix?: () => void;
  onToggleCase?: () => void;
}

export interface EditorContextMenuItemOptions extends EditorContextMenuHandlers {
  hasSelection: boolean;
}

function isDisabled(handler: (() => void) | undefined, disabled = false): boolean {
  return disabled || !handler;
}

export function buildEditorContextMenuGroups({
  hasSelection,
  onCopy,
  onCut,
  onPaste,
  onSelectAll,
  onDelete,
  onFind,
  onGoToDefinition,
  onFindReferences,
  onRenameSymbol,
  onToggleComment,
  onFormat,
  onFormatSelection,
  onQuickFix,
  onToggleCase,
}: EditorContextMenuItemOptions): ContextMenuGroupData[] {
  return [
    {
      id: "editing",
      items: [
        {
          id: "copy",
          label: "Copy",
          icon: <Copy />,
          disabled: isDisabled(onCopy, !hasSelection),
          onClick: onCopy,
        },
        {
          id: "cut",
          label: "Cut",
          icon: <Scissors />,
          disabled: isDisabled(onCut, !hasSelection),
          onClick: onCut,
        },
        {
          id: "paste",
          label: "Paste",
          icon: <ClipboardPaste />,
          disabled: isDisabled(onPaste),
          onClick: onPaste,
        },
        {
          id: "delete",
          label: "Delete",
          icon: <Trash2 />,
          disabled: isDisabled(onDelete, !hasSelection),
          onClick: onDelete,
        },
        {
          id: "select-all",
          label: "Select All",
          icon: <Type />,
          disabled: isDisabled(onSelectAll),
          onClick: onSelectAll,
        },
      ],
    },
    {
      id: "code",
      items: [
        {
          id: "quick-fix",
          label: "Quick Fix...",
          icon: <PenLine />,
          disabled: isDisabled(onQuickFix),
          onClick: onQuickFix,
        },
        {
          id: "go-to-definition",
          label: "Go to Definition",
          icon: <Code />,
          disabled: isDisabled(onGoToDefinition),
          onClick: onGoToDefinition,
        },
        {
          id: "find-references",
          label: "Find All References",
          icon: <Search />,
          disabled: isDisabled(onFindReferences),
          onClick: onFindReferences,
        },
        {
          id: "rename-symbol",
          label: "Rename Symbol",
          icon: <PenLine />,
          disabled: isDisabled(onRenameSymbol),
          onClick: onRenameSymbol,
        },
        {
          id: "toggle-comment",
          label: "Toggle Comment",
          icon: <Code />,
          disabled: isDisabled(onToggleComment),
          onClick: onToggleComment,
        },
        {
          id: hasSelection ? "format-selection" : "format",
          label: hasSelection ? "Format Selection" : "Format Document",
          icon: <AlignLeft />,
          disabled: hasSelection ? isDisabled(onFormatSelection) : isDisabled(onFormat),
          onClick: hasSelection ? onFormatSelection : onFormat,
        },
        {
          id: "toggle-case",
          label: "Toggle Case",
          icon: <CaseSensitive />,
          disabled: isDisabled(onToggleCase, !hasSelection),
          onClick: onToggleCase,
        },
      ],
    },
    {
      id: "navigation",
      items: [
        {
          id: "find",
          label: "Find",
          icon: <Search />,
          disabled: isDisabled(onFind),
          onClick: onFind,
        },
      ],
    },
  ];
}
