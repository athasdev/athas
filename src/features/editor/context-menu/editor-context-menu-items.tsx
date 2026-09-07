import {
  CaseSensitiveIcon,
  ClipboardTextIcon,
  CodeIcon,
  CopyIcon,
  PencilLineIcon,
  ScissorsIcon,
  SearchIcon,
  TextAlignLeftIcon,
  TextIcon,
  TrashIcon,
} from "@/ui/icons";
import type { ContextMenuGroupData } from "@/ui/context-menu";

export interface EditorContextMenuHandlers {
  onShareSelection?: () => void;
  onShareBuffer?: () => void;
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
  onShareSelection,
  onShareBuffer,
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
      id: "sharing",
      items: [
        {
          id: "share-selection",
          label: "Share Selection to Web…",
          disabled: !hasSelection || !onShareSelection,
          onClick: onShareSelection,
        },
        {
          id: "share-buffer",
          label: "Share Buffer to Web…",
          disabled: !onShareBuffer,
          onClick: onShareBuffer,
        },
      ],
    },
    {
      id: "editing",
      items: [
        {
          id: "copy",
          label: "Copy",
          icon: <CopyIcon />,
          disabled: isDisabled(onCopy, !hasSelection),
          onClick: onCopy,
        },
        {
          id: "cut",
          label: "Cut",
          icon: <ScissorsIcon />,
          disabled: isDisabled(onCut, !hasSelection),
          onClick: onCut,
        },
        {
          id: "paste",
          label: "Paste",
          icon: <ClipboardTextIcon />,
          disabled: isDisabled(onPaste),
          onClick: onPaste,
        },
        {
          id: "delete",
          label: "Delete",
          icon: <TrashIcon />,
          disabled: isDisabled(onDelete, !hasSelection),
          onClick: onDelete,
        },
        {
          id: "select-all",
          label: "Select All",
          icon: <TextIcon />,
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
          icon: <PencilLineIcon />,
          disabled: isDisabled(onQuickFix),
          onClick: onQuickFix,
        },
        {
          id: "go-to-definition",
          label: "Go to Definition",
          icon: <CodeIcon />,
          disabled: isDisabled(onGoToDefinition),
          onClick: onGoToDefinition,
        },
        {
          id: "find-references",
          label: "Find All References",
          icon: <SearchIcon />,
          disabled: isDisabled(onFindReferences),
          onClick: onFindReferences,
        },
        {
          id: "rename-symbol",
          label: "Rename Symbol",
          icon: <PencilLineIcon />,
          disabled: isDisabled(onRenameSymbol),
          onClick: onRenameSymbol,
        },
        {
          id: "toggle-comment",
          label: "Toggle Comment",
          icon: <CodeIcon />,
          disabled: isDisabled(onToggleComment),
          onClick: onToggleComment,
        },
        {
          id: hasSelection ? "format-selection" : "format",
          label: hasSelection ? "Format Selection" : "Format Document",
          icon: <TextAlignLeftIcon />,
          disabled: hasSelection ? isDisabled(onFormatSelection) : isDisabled(onFormat),
          onClick: hasSelection ? onFormatSelection : onFormat,
        },
        {
          id: "toggle-case",
          label: "Toggle Case",
          icon: <CaseSensitiveIcon />,
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
          icon: <SearchIcon />,
          disabled: isDisabled(onFind),
          onClick: onFind,
        },
      ],
    },
  ];
}
