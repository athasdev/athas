import { ClockIcon } from "lucide-react";
import type React from "react";
import { useEffect } from "react";
import { cn } from "@/utils/cn";
import { useFileSystemStore } from "../stores/file-system-store";
import { useRecentFoldersStore } from "../stores/recent-folders-store";
import { useUIState } from "../stores/ui-state-store";
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

export const ProjectNameMenu = () => {
  // Get data from stores
  const { projectNameMenu, setProjectNameMenu } = useUIState();
  const { handleOpenFolder, handleCollapseAllFolders } = useFileSystemStore();
  const { recentFolders, openRecentFolder } = useRecentFoldersStore();

  const onCloseMenu = () => setProjectNameMenu(null);
  const onOpenFolder = handleOpenFolder;
  const onCollapseAllFolders = handleCollapseAllFolders;
  const onOpenRecentFolder = openRecentFolder;
  if (!projectNameMenu) return null;

  return (
    <div
      className="fixed z-50 min-w-[200px] rounded-md border border-border bg-secondary-bg py-1 shadow-lg"
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
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5",
          "text-left font-mono text-text text-xs hover:bg-hover",
        )}
      >
        Add Folder to Workspace
      </button>

      <button
        onMouseDown={e => {
          e.preventDefault();
          e.stopPropagation();
          onCollapseAllFolders();
          onCloseMenu();
        }}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5",
          "text-left font-mono text-text text-xs hover:bg-hover",
        )}
      >
        Collapse All Folders
      </button>

      {recentFolders.length > 0 && (
        <>
          <div className="my-1 border-border border-t"></div>
          <div className="flex items-center gap-1 px-3 py-1 font-mono text-text-lighter text-xs tracking-wide">
            <ClockIcon size="10" />
            Recent Folders
          </div>
          {recentFolders.slice(0, 5).map((folder: RecentFolder) => (
            <button
              key={folder.path}
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                onOpenRecentFolder(folder.path);
                onCloseMenu();
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5",
                "text-left font-mono text-text text-xs hover:bg-hover",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col items-start">
                <span className="truncate font-medium">{folder.name}</span>
              </div>
            </button>
          ))}
        </>
      )}
    </div>
  );
};
