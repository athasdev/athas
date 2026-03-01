import { Copy, FolderOpen, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ProjectTab } from "@/stores/workspace-tabs-store";

interface ProjectTabsContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  tab: ProjectTab | null;
  totalTabs: number;
  onClose: () => void;
  onCloseProject: (projectId: string) => void;
  onCloseOthers: (projectId: string) => void;
  onCloseToRight: (projectId: string) => void;
  onCloseAll: () => void;
  onCopyPath: (path: string) => void;
  onRevealInFinder: (path: string) => void;
}

const ProjectTabsContextMenu = ({
  isOpen,
  position,
  tab,
  totalTabs,
  onClose,
  onCloseProject,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onCopyPath,
  onRevealInFinder,
}: ProjectTabsContextMenuProps) => {
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

  if (!isOpen || !tab) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[10040] min-w-[190px] select-none rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: "translateZ(0)",
      }}
    >
      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCopyPath(tab.path);
          onClose();
        }}
      >
        <Copy size={12} />
        Copy Path
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onRevealInFinder(tab.path);
          onClose();
        }}
      >
        <FolderOpen size={12} />
        Reveal in Finder
      </button>

      <div className="my-0.5 border-border/70 border-t" />

      {totalTabs > 1 && (
        <button
          className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
          onClick={() => {
            onCloseProject(tab.id);
            onClose();
          }}
        >
          <X size={12} />
          Close Project
        </button>
      )}

      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseOthers(tab.id);
          onClose();
        }}
      >
        Close Other Projects
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseToRight(tab.id);
          onClose();
        }}
      >
        Close to Right
      </button>

      {totalTabs > 1 && (
        <button
          className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
          onClick={() => {
            onCloseAll();
            onClose();
          }}
        >
          Close All Projects
        </button>
      )}
    </div>
  );
};

export default ProjectTabsContextMenu;
