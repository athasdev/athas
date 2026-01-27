import { Columns2, Copy, FolderOpen, Pin, PinOff, RotateCcw, Rows2, Terminal } from "lucide-react";
import { useEffect, useRef } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import type { Buffer } from "@/features/tabs/types/buffer";
import KeybindingBadge from "@/ui/keybinding-badge";

interface TabContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  buffer: Buffer | null;
  paneId?: string;
  onClose: () => void;
  onPin: (bufferId: string) => void;
  onCloseTab: (bufferId: string) => void;
  onCloseOthers: (bufferId: string) => void;
  onCloseAll: () => void;
  onCloseToRight: (bufferId: string) => void;
  onCopyPath?: (path: string) => void;
  onCopyRelativePath?: (path: string) => void;
  onReload?: (bufferId: string) => void;
  onRevealInFinder?: (path: string) => void;
  onSplitRight?: (paneId: string, bufferId: string) => void;
  onSplitDown?: (paneId: string, bufferId: string) => void;
}

const TabContextMenu = ({
  isOpen,
  position,
  buffer,
  paneId,
  onClose,
  onPin,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onCloseToRight,
  onCopyPath,
  onCopyRelativePath,
  onReload,
  onRevealInFinder,
  onSplitRight,
  onSplitDown,
}: TabContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

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
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Start with the provided position (already zoom-adjusted)
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

  if (!isOpen || !buffer) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-[190px] select-none rounded-md border border-border bg-secondary-bg py-0.5 shadow-lg"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: "translateZ(0)", // Force GPU acceleration for consistent rendering
      }}
    >
      <button
        className="ui-font flex w-full items-center gap-2 px-2.5 py-1 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onPin(buffer.id);
          onClose();
        }}
      >
        {buffer.isPinned ? <PinOff size={11} /> : <Pin size={11} />}
        {buffer.isPinned ? "Unpin Tab" : "Pin Tab"}
      </button>

      <div className="my-0.5 border-border border-t" />

      {paneId && onSplitRight && (
        <button
          className="ui-font flex w-full items-center gap-2 px-2.5 py-1 text-left text-text text-xs hover:bg-hover"
          onClick={() => {
            onSplitRight(paneId, buffer.id);
            onClose();
          }}
        >
          <Columns2 size={11} />
          Split Right
        </button>
      )}

      {paneId && onSplitDown && (
        <button
          className="ui-font flex w-full items-center gap-2 px-2.5 py-1 text-left text-text text-xs hover:bg-hover"
          onClick={() => {
            onSplitDown(paneId, buffer.id);
            onClose();
          }}
        >
          <Rows2 size={11} />
          Split Down
        </button>
      )}

      {paneId && (onSplitRight || onSplitDown) && <div className="my-0.5 border-border border-t" />}

      <button
        className="ui-font flex w-full items-center gap-2 px-2.5 py-1 text-left text-text text-xs hover:bg-hover"
        onClick={async () => {
          if (onCopyPath) {
            onCopyPath(buffer.path);
          } else {
            try {
              await navigator.clipboard.writeText(buffer.path);
            } catch (error) {
              console.error("Failed to copy path:", error);
            }
          }
          onClose();
        }}
      >
        <Copy size={11} />
        Copy Path
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 px-2.5 py-1 text-left text-text text-xs hover:bg-hover"
        onClick={async () => {
          if (onCopyRelativePath) {
            onCopyRelativePath(buffer.path);
          }
          onClose();
        }}
      >
        <Copy size={11} />
        Copy Relative Path
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 px-2.5 py-1 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onRevealInFinder?.(buffer.path);
          onClose();
        }}
      >
        <FolderOpen size={11} />
        Reveal in Finder
      </button>

      {!buffer.isVirtual && !buffer.path.includes("://") && (
        <button
          className="ui-font flex w-full items-center gap-2 px-2.5 py-1 text-left text-text text-xs hover:bg-hover"
          onClick={() => {
            const dirPath = buffer.path.substring(0, buffer.path.lastIndexOf("/"));
            const dirName = dirPath.split("/").pop() || "terminal";
            const { openTerminalBuffer } = useBufferStore.getState().actions;
            openTerminalBuffer({
              name: dirName,
              workingDirectory: dirPath,
            });
            onClose();
          }}
        >
          <Terminal size={11} />
          Open in Terminal
        </button>
      )}

      {buffer.path !== "extensions://marketplace" && (
        <button
          className="ui-font flex w-full items-center gap-2 px-2.5 py-1 text-left text-text text-xs hover:bg-hover"
          onClick={() => {
            if (onReload) {
              onReload(buffer.id);
            }
            onClose();
          }}
        >
          <RotateCcw size={11} />
          Reload
        </button>
      )}

      <div className="my-0.5 border-border border-t" />
      <button
        className="ui-font flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseTab(buffer.id);
          onClose();
        }}
      >
        <span>Close</span>
        <KeybindingBadge keys={["⌘", "W"]} className="opacity-60" />
      </button>
      <button
        className="ui-font w-full px-2.5 py-1 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseOthers(buffer.id);
          onClose();
        }}
      >
        Close Others
      </button>
      <button
        className="ui-font w-full px-2.5 py-1 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseToRight(buffer.id);
          onClose();
        }}
      >
        Close to Right
      </button>
      <button
        className="ui-font w-full px-2.5 py-1 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseAll();
          onClose();
        }}
      >
        Close All
      </button>
    </div>
  );
};

export default TabContextMenu;
