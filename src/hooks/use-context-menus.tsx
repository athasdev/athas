import type React from "react";
import { useEffect } from "react";
import type { RecentFolder } from "../types/recent-folders";

interface UseContextMenusProps {
  folderHeaderContextMenu: { x: number; y: number } | null;
  projectNameMenu: { x: number; y: number } | null;
  setFolderHeaderContextMenu: (menu: { x: number; y: number } | null) => void;
  setProjectNameMenu: (menu: { x: number; y: number } | null) => void;
}

export const useContextMenus = ({
  folderHeaderContextMenu,
  projectNameMenu,
  setFolderHeaderContextMenu,
  setProjectNameMenu,
}: UseContextMenusProps) => {
  // Handle clicking outside context menu to close it
  useEffect(() => {
    const handleClickOutside = () => {
      setFolderHeaderContextMenu(null);
      setProjectNameMenu(null);
    };

    if (folderHeaderContextMenu || projectNameMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [folderHeaderContextMenu, projectNameMenu, setFolderHeaderContextMenu, setProjectNameMenu]);

  const handleProjectNameMenuOpen = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setProjectNameMenu({
      x: event.currentTarget.getBoundingClientRect().left,
      y: event.currentTarget.getBoundingClientRect().bottom + 5,
    });
  };

  const closeAllMenus = () => {
    setFolderHeaderContextMenu(null);
    setProjectNameMenu(null);
  };

  return {
    handleProjectNameMenuOpen,
    closeAllMenus,
  };
};

interface ProjectNameMenuProps {
  projectNameMenu: { x: number; y: number } | null;
  recentFolders: RecentFolder[];
  onOpenFolder: () => void;
  onCollapseAllFolders: () => void;
  onOpenRecentFolder: (path: string) => void;
  onCloseMenu: () => void;
}

export const ProjectNameMenu = ({
  projectNameMenu,
  recentFolders,
  onOpenFolder,
  onCollapseAllFolders,
  onOpenRecentFolder,
  onCloseMenu,
}: ProjectNameMenuProps) => {
  if (!projectNameMenu) return null;

  return (
    <div
      className="fixed bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded-md shadow-lg z-50 py-1 min-w-[200px]"
      style={{
        left: projectNameMenu.x,
        top: projectNameMenu.y,
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <button
        onMouseDown={e => {
          e.preventDefault();
          e.stopPropagation();
          onOpenFolder();
          onCloseMenu();
        }}
        className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
      >
        <span>📁</span>
        Add Folder to Workspace
      </button>

      <button
        onMouseDown={e => {
          e.preventDefault();
          e.stopPropagation();
          onCollapseAllFolders();
          onCloseMenu();
        }}
        className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
      >
        <span>📂</span>
        Collapse All Folders
      </button>

      {recentFolders.length > 0 && (
        <>
          <div className="border-t border-[var(--border-color)] my-1"></div>
          <div className="px-3 py-1 text-xs font-mono text-[var(--text-lighter)] uppercase tracking-wide">
            Recent Folders
          </div>
          {recentFolders.slice(0, 5).map(folder => (
            <button
              key={folder.path}
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                onOpenRecentFolder(folder.path);
                onCloseMenu();
              }}
              className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
            >
              <span>📁</span>
              <div className="flex flex-col items-start min-w-0 flex-1">
                <span className="truncate font-medium">{folder.name}</span>
              </div>
            </button>
          ))}
        </>
      )}
    </div>
  );
};
