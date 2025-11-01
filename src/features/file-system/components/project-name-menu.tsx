import { ClockIcon } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import { useOnClickOutside } from "usehooks-ts";
import { useRecentFoldersStore } from "@/features/file-system/controllers/recent-folders-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { RecentFolder } from "@/features/file-system/types/recent-folders";
import { useUIState } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";

export const ProjectNameMenu = () => {
  const menuRef = useRef<HTMLDivElement>(null);
  // Get data from stores
  const { projectNameMenu, setProjectNameMenu } = useUIState();
  const { handleOpenFolder, handleCollapseAllFolders } = useFileSystemStore();
  const { recentFolders, openRecentFolder } = useRecentFoldersStore();

  const onCloseMenu = () => setProjectNameMenu(null);
  const onOpenFolder = handleOpenFolder;
  const onCollapseAllFolders = handleCollapseAllFolders;
  const onOpenRecentFolder = openRecentFolder;

  // Close menu on outside click
  useOnClickOutside(menuRef as RefObject<HTMLElement>, () => {
    setProjectNameMenu(null);
  });

  // Close menu on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProjectNameMenu(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setProjectNameMenu]);

  if (!projectNameMenu) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] rounded-md border border-border bg-secondary-bg py-1 shadow-lg"
      style={{
        left: projectNameMenu.x,
        top: projectNameMenu.y,
      }}
    >
      <button
        onMouseDown={(e) => {
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
        onMouseDown={(e) => {
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
              onMouseDown={(e) => {
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
