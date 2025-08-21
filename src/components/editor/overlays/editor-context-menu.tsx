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
import { useEffect, useRef } from "react";
import { editorAPI } from "@/extensions/editor-api";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import KeybindingBadge from "../../ui/keybinding-badge";

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
  onInsertLine?: () => void;
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
  onInsertLine,
  onToggleBookmark,
}: EditorContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const selection = useEditorCursorStore.use.selection?.() ?? undefined;
  const hasSelection = selection && selection.start.offset !== selection.end.offset;

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    // Adjust menu position to ensure it's visible
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportRef = editorAPI.getViewportRef();
      const viewportWidth = viewportRef!.getBoundingClientRect().width;
      const viewportHeight = viewportRef!.getBoundingClientRect().height;

      // Start with the provided position
      let adjustedX = position.x;
      let adjustedY = position.y;

      // Prevent menu from going off the right edge
      if (adjustedX + rect.width > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 10;
      }

      // Prevent menu from going off the bottom edge
      if (adjustedY + rect.height > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 10;
      }

      // Prevent menu from going off the left edge
      if (adjustedX < 0) {
        adjustedX = 10;
      }

      // Prevent menu from going off the top edge
      if (adjustedY < 0) {
        adjustedY = 10;
      }

      // Apply the adjusted position directly
      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose, position]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (onCopy) {
      onCopy();
    } else if (hasSelection && selection) {
      // Default copy behavior will be handled by the parent component
      // This is a fallback that won't actually work without parent handling
      console.warn("Copy action requires parent component to handle onCopy");
    }
    onClose();
  };

  const handleCut = async () => {
    if (onCut) {
      onCut();
    }
    onClose();
  };

  const handlePaste = async () => {
    if (onPaste) {
      onPaste();
    }
    onClose();
  };

  const handleSelectAll = () => {
    if (onSelectAll) {
      onSelectAll();
    }
    onClose();
  };

  const handleFind = () => {
    if (onFind) {
      onFind();
    }
    onClose();
  };

  const handleGoToLine = () => {
    if (onGoToLine) {
      onGoToLine();
    }
    onClose();
  };

  // Additional handlers
  const handleDelete = () => {
    if (onDelete) onDelete();
    onClose();
  };

  const handleDuplicate = () => {
    if (onDuplicate) onDuplicate();
    onClose();
  };

  const handleIndent = () => {
    if (onIndent) onIndent();
    onClose();
  };

  const handleOutdent = () => {
    if (onOutdent) onOutdent();
    onClose();
  };

  const handleToggleComment = () => {
    if (onToggleComment) onToggleComment();
    onClose();
  };

  const handleFormat = () => {
    if (onFormat) onFormat();
    onClose();
  };

  const handleToggleCase = () => {
    if (onToggleCase) onToggleCase();
    onClose();
  };

  const handleMoveLineUp = () => {
    if (onMoveLineUp) onMoveLineUp();
    onClose();
  };

  const handleMoveLineDown = () => {
    if (onMoveLineDown) onMoveLineDown();
    onClose();
  };

  const _handleInsertLine = () => {
    if (onInsertLine) onInsertLine();
    onClose();
  };

  const handleToggleBookmark = () => {
    if (onToggleBookmark) onToggleBookmark();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-99 w-[200px] select-none rounded-md border border-border bg-secondary-bg py-0.5 shadow-lg"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: "translateZ(0)", // Force GPU acceleration for consistent rendering
      }}
    >
      {/* Copy */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        onClick={handleCopy}
        disabled={!hasSelection}
      >
        <div className="flex items-center gap-2">
          <Copy size={11} />
          <span>Copy</span>
        </div>
        <KeybindingBadge keys={["⌘", "C"]} className="opacity-60" />
      </button>

      {/* Cut */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        onClick={handleCut}
        disabled={!hasSelection}
      >
        <div className="flex items-center gap-2">
          <Scissors size={11} />
          <span>Cut</span>
        </div>
        <KeybindingBadge keys={["⌘", "X"]} className="opacity-60" />
      </button>

      {/* Paste */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={handlePaste}
      >
        <div className="flex items-center gap-2">
          <ClipboardPaste size={11} />
          <span>Paste</span>
        </div>
        <KeybindingBadge keys={["⌘", "V"]} className="opacity-60" />
      </button>

      {/* Delete */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        onClick={handleDelete}
        disabled={!hasSelection}
      >
        <div className="flex items-center gap-2">
          <Trash2 size={11} />
          <span>Delete</span>
        </div>
        <KeybindingBadge keys={["Del"]} className="opacity-60" />
      </button>

      <div className="my-0.5 border-border border-t" />

      {/* Select All */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={handleSelectAll}
      >
        <div className="flex items-center gap-2">
          <Type size={11} />
          <span>Select All</span>
        </div>
        <KeybindingBadge keys={["⌘", "A"]} className="opacity-60" />
      </button>

      {/* Duplicate Line */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={handleDuplicate}
      >
        <div className="flex items-center gap-2">
          <FileText size={11} />
          <span>Duplicate Line</span>
        </div>
        <KeybindingBadge keys={["⌘", "D"]} className="opacity-60" />
      </button>

      <div className="my-0.5 border-border border-t" />

      {/* Toggle Comment */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={handleToggleComment}
      >
        <div className="flex items-center gap-2">
          <Code size={11} />
          <span>Toggle Comment</span>
        </div>
        <KeybindingBadge keys={["⌘", "/"]} className="opacity-60" />
      </button>

      {/* Indent */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={handleIndent}
      >
        <div className="flex items-center gap-2">
          <Indent size={11} />
          <span>Indent</span>
        </div>
        <KeybindingBadge keys={["Tab"]} className="opacity-60" />
      </button>

      {/* Outdent */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={handleOutdent}
      >
        <div className="flex items-center gap-2">
          <Outdent size={11} />
          <span>Outdent</span>
        </div>
        <KeybindingBadge keys={["⇧", "Tab"]} className="opacity-60" />
      </button>

      {/* Format */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={handleFormat}
      >
        <div className="flex items-center gap-2">
          <AlignLeft size={11} />
          <span>Format Document</span>
        </div>
        <KeybindingBadge keys={["⇧", "⌥", "F"]} className="opacity-60" />
      </button>

      <div className="my-0.5 border-border border-t" />

      {/* Move Line Up */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={handleMoveLineUp}
      >
        <div className="flex items-center gap-2">
          <ChevronUp size={11} />
          <span>Move Line Up</span>
        </div>
        <KeybindingBadge keys={["⌥", "↑"]} className="opacity-60" />
      </button>

      {/* Move Line Down */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={handleMoveLineDown}
      >
        <div className="flex items-center gap-2">
          <ChevronDown size={11} />
          <span>Move Line Down</span>
        </div>
        <KeybindingBadge keys={["⌥", "↓"]} className="opacity-60" />
      </button>

      {/* Toggle Case */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        onClick={handleToggleCase}
        disabled={!hasSelection}
      >
        <div className="flex items-center gap-2">
          <CaseSensitive size={11} />
          <span>Toggle Case</span>
        </div>
      </button>

      <div className="my-0.5 border-border border-t" />

      {/* Find */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={handleFind}
      >
        <div className="flex items-center gap-2">
          <Search size={11} />
          <span>Find</span>
        </div>
        <KeybindingBadge keys={["⌘", "F"]} className="opacity-60" />
      </button>

      {/* Go to Line */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={handleGoToLine}
      >
        <div className="flex items-center gap-2">
          <RotateCcw size={11} />
          <span>Go to Line</span>
        </div>
        <KeybindingBadge keys={["⌘", "G"]} className="opacity-60" />
      </button>

      {/* Toggle Bookmark */}
      <button
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={handleToggleBookmark}
      >
        <div className="flex items-center gap-2">
          <Bookmark size={11} />
          <span>Toggle Bookmark</span>
        </div>
        <KeybindingBadge keys={["⌘", "K", "⌘", "K"]} className="opacity-60" />
      </button>
    </div>
  );
};

export default EditorContextMenu;
