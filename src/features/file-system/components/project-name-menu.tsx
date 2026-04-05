import { ClockIcon, FolderOpen, PanelTopClose } from "lucide-react";
import { useMemo } from "react";
import { useRecentFoldersStore } from "@/features/file-system/controllers/recent-folders-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { RecentFolder } from "@/features/file-system/types/recent-folders";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";

export const ProjectNameMenu = () => {
  const { projectNameMenu, setProjectNameMenu } = useUIState();
  const { handleOpenFolder, handleCollapseAllFolders } = useFileSystemStore();
  const { recentFolders, openRecentFolder } = useRecentFoldersStore();

  const items = useMemo<ContextMenuItem[]>(() => {
    const baseItems: ContextMenuItem[] = [
      {
        id: "open-folder",
        label: "Open Folder in New Tab",
        icon: <FolderOpen />,
        onClick: () => handleOpenFolder(),
      },
      {
        id: "collapse-folders",
        label: "Collapse All Folders",
        icon: <PanelTopClose />,
        onClick: () => handleCollapseAllFolders(),
      },
    ];

    if (recentFolders.length === 0) {
      return baseItems;
    }

    const recentItems: ContextMenuItem[] = recentFolders
      .slice(0, 5)
      .map((folder: RecentFolder) => ({
        id: `recent-${folder.path}`,
        label: folder.name,
        icon: <ClockIcon />,
        onClick: () => openRecentFolder(folder.path),
      }));

    return [
      ...baseItems,
      { id: "sep-recent", label: "", separator: true, onClick: () => {} },
      ...recentItems,
    ];
  }, [handleCollapseAllFolders, handleOpenFolder, openRecentFolder, recentFolders]);

  if (!projectNameMenu) return null;

  return (
    <ContextMenu
      isOpen
      position={{ x: projectNameMenu.x, y: projectNameMenu.y }}
      items={items}
      onClose={() => setProjectNameMenu(null)}
      className="min-w-[220px]"
    />
  );
};
