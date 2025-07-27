// todo: we should make a context menu component that can be used for other things too
import { Copy, FolderOpen, Pin, PinOff, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Buffer } from "../../types/buffer";
import KeybindingBadge from "../ui/keybinding-badge";

interface TabContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  buffer: Buffer | null;
  onClose: () => void;
  onPin: (bufferId: string) => void;
  onCloseTab: (bufferId: string) => void;
  onCloseOthers: (bufferId: string) => void;
  onCloseAll: () => void;
  onCloseToRight: (bufferId: string) => void;
  onCopyPath?: (path: string) => void;
  onReload?: (bufferId: string) => void;
  onRevealInFinder?: (path: string) => void;
}

const TabContextMenu = ({
  isOpen,
  position,
  buffer,
  onClose,
  onPin,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onCloseToRight,
  onCopyPath,
  onReload,
  onRevealInFinder,
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
      className="fixed z-50 w-[180px] select-none rounded-md border border-border bg-secondary-bg py-1 shadow-lg"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translateZ(0)' // Force GPU acceleration for consistent rendering
      }}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={() => {
          onPin(buffer.id);
          onClose();
        }}
      >
        {buffer.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        {buffer.isPinned ? "Unpin Tab" : "Pin Tab"}
      </button>

      <div className="my-1 border-border border-t" />

      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
        <Copy size={12} />
        Copy Path
      </button>

      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={() => {
          if (onRevealInFinder) {
            onRevealInFinder(buffer.path);
          }
          onClose();
        }}
      >
        <FolderOpen size={12} />
        Reveal in Finder
      </button>

      {buffer.path !== "extensions://marketplace" && (
        <button
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
          onClick={() => {
            if (onReload) {
              onReload(buffer.id);
            }
            onClose();
          }}
        >
          <RotateCcw size={12} />
          Reload
        </button>
      )}

      <div className="my-1 border-border border-t" />
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseTab(buffer.id);
          onClose();
        }}
      >
        <span>Close</span>
        <KeybindingBadge keys={["⌘", "W"]} className="opacity-60" />
      </button>
      <button
        className="w-full px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseOthers(buffer.id);
          onClose();
        }}
      >
        Close Others
      </button>
      <button
        className="w-full px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseToRight(buffer.id);
          onClose();
        }}
      >
        Close to Right
      </button>
      <button
        className="w-full px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
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
